[CmdletBinding(DefaultParameterSetName = 'Manage')]
param(
  [Parameter(ParameterSetName = 'List', Mandatory = $true)]
  [switch]$ListDisplays,

  [Parameter(ParameterSetName = 'Manage', Mandatory = $true)]
  [string]$ExecutablePath,

  [Parameter(ParameterSetName = 'Manage', Mandatory = $true)]
  [string]$UserDataDir,

  [Parameter(ParameterSetName = 'Manage', Mandatory = $true)]
  [string]$Display,

  [Parameter(ParameterSetName = 'Manage', Mandatory = $true)]
  [int]$X,

  [Parameter(ParameterSetName = 'Manage', Mandatory = $true)]
  [int]$Y,

  [Parameter(ParameterSetName = 'Manage', Mandatory = $true)]
  [int]$Width,

  [Parameter(ParameterSetName = 'Manage', Mandatory = $true)]
  [int]$Height,

  [Parameter(ParameterSetName = 'Manage', Mandatory = $true)]
  [ValidateSet('true', 'false')]
  [string]$PreventFocus,

  [Parameter(ParameterSetName = 'Manage', Mandatory = $true)]
  [string]$StatusFile,

  [Parameter(ParameterSetName = 'Manage')]
  [int]$StartupTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class TestWindowNativeMethods
{
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr hWndInsertAfter,
        int X,
        int Y,
        int cx,
        int cy,
        uint uFlags);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);
}
'@

[TestWindowNativeMethods]::SetProcessDPIAware() | Out-Null

function Get-DisplayInfo {
  return @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
    [pscustomobject]@{
      Name = $_.DeviceName.Replace('\\.\', '')
      DeviceName = $_.DeviceName
      Primary = $_.Primary
      Left = $_.WorkingArea.Left
      Top = $_.WorkingArea.Top
      Width = $_.WorkingArea.Width
      Height = $_.WorkingArea.Height
      Bounds = "$($_.Bounds.Left),$($_.Bounds.Top) $($_.Bounds.Width)x$($_.Bounds.Height)"
      WorkingArea = "$($_.WorkingArea.Left),$($_.WorkingArea.Top) $($_.WorkingArea.Width)x$($_.WorkingArea.Height)"
    }
  })
}

$displays = Get-DisplayInfo
if ($ListDisplays) {
  $displays |
    Select-Object Name, Primary, Bounds, WorkingArea |
    Format-Table -AutoSize |
    Out-String -Width 200 |
    Write-Output
  exit 0
}

$targetDisplay = if ($Display.Equals('primary', [System.StringComparison]::OrdinalIgnoreCase)) {
  $displays | Where-Object { $_.Primary } | Select-Object -First 1
} else {
  $normalizedDisplay = $Display.Replace('\\.\', '')
  $displays | Where-Object {
    $_.Name.Equals($normalizedDisplay, [System.StringComparison]::OrdinalIgnoreCase) -or
    $_.DeviceName.Equals($Display, [System.StringComparison]::OrdinalIgnoreCase)
  } | Select-Object -First 1
}

if ($null -eq $targetDisplay) {
  $available = ($displays | ForEach-Object { $_.Name }) -join ', '
  throw "Test window display '$Display' was not found. Available displays: $available. Run npm run test:displays for details."
}

if ($X -lt 0 -or $Y -lt 0 -or $Width -lt 640 -or $Height -lt 480) {
  throw 'Test window coordinates must be non-negative integers and its size must be at least 640x480.'
}
if (($X + $Width) -gt $targetDisplay.Width -or ($Y + $Height) -gt $targetDisplay.Height) {
  throw "Test window ${Width}x${Height} at relative position ($X,$Y) exceeds the $($targetDisplay.Name) working area $($targetDisplay.Width)x$($targetDisplay.Height)."
}

$absoluteX = $targetDisplay.Left + $X
$absoluteY = $targetDisplay.Top + $Y
$shouldPreventFocus = $PreventFocus -eq 'true'
$lastForegroundWindow = [TestWindowNativeMethods]::GetForegroundWindow()
$deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
$testProcess = $null
$testWindow = [IntPtr]::Zero
$executableFullPath = [System.IO.Path]::GetFullPath($ExecutablePath)

Write-Output "READY display=$($targetDisplay.Name) rectangle=${absoluteX},${absoluteY},${Width},${Height} preventFocus=$shouldPreventFocus"

while ([DateTime]::UtcNow -lt $deadline -and $testWindow -eq [IntPtr]::Zero) {
  $candidate = Get-CimInstance Win32_Process -Filter "Name = '$([System.IO.Path]::GetFileName($executableFullPath))'" |
    Where-Object {
      $_.ExecutablePath -and
      [System.IO.Path]::GetFullPath($_.ExecutablePath).Equals($executableFullPath, [System.StringComparison]::OrdinalIgnoreCase) -and
      $_.CommandLine -and
      $_.CommandLine.Contains($UserDataDir)
    } |
    Select-Object -First 1

  if ($null -ne $candidate) {
    $testProcess = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
    if ($null -ne $testProcess) {
      $testProcess.Refresh()
      $testWindow = $testProcess.MainWindowHandle
    }
  }

  if ($testWindow -eq [IntPtr]::Zero) {
    Start-Sleep -Milliseconds 50
  }
}

if ($testWindow -eq [IntPtr]::Zero -or $null -eq $testProcess) {
  throw "The integration-test VS Code window was not found within $StartupTimeoutSeconds seconds."
}

$GwlExStyle = -20
$WsExNoActivate = 0x08000000L
$SwpNoZOrder = 0x0004
$SwpNoActivate = 0x0010
$SwpFrameChanged = 0x0020
$SwpAsyncWindowPos = 0x4000

if ($shouldPreventFocus) {
  $currentStyle = [TestWindowNativeMethods]::GetWindowLongPtr($testWindow, $GwlExStyle).ToInt64()
  $updatedStyle = [IntPtr]($currentStyle -bor $WsExNoActivate)
  [TestWindowNativeMethods]::SetWindowLongPtr($testWindow, $GwlExStyle, $updatedStyle) | Out-Null
}

$positionFlags = $SwpNoZOrder -bor $SwpNoActivate -bor $SwpFrameChanged -bor $SwpAsyncWindowPos
$positioned = [TestWindowNativeMethods]::SetWindowPos(
  $testWindow,
  [IntPtr]::Zero,
  $absoluteX,
  $absoluteY,
  $Width,
  $Height,
  $positionFlags)
if (-not $positioned) {
  throw 'Unable to set the integration-test VS Code window position and size.'
}

$foregroundWindow = [TestWindowNativeMethods]::GetForegroundWindow()
if ($shouldPreventFocus -and $foregroundWindow -eq $testWindow -and
    $lastForegroundWindow -ne [IntPtr]::Zero -and
    [TestWindowNativeMethods]::IsWindow($lastForegroundWindow)) {
  [TestWindowNativeMethods]::SetForegroundWindow($lastForegroundWindow) | Out-Null
}

$status = [pscustomobject]@{
  display = $targetDisplay.Name
  x = $absoluteX
  y = $absoluteY
  width = $Width
  height = $Height
  preventFocus = $shouldPreventFocus
  processId = $testProcess.Id
  windowHandle = $testWindow.ToInt64()
}
$status | ConvertTo-Json -Compress | Set-Content -LiteralPath $StatusFile -Encoding UTF8
Write-Output "MANAGED $($status | ConvertTo-Json -Compress)"

while (-not $testProcess.HasExited -and [TestWindowNativeMethods]::IsWindow($testWindow)) {
  $currentForegroundWindow = [TestWindowNativeMethods]::GetForegroundWindow()
  if ($currentForegroundWindow -ne [IntPtr]::Zero -and $currentForegroundWindow -ne $testWindow) {
    $lastForegroundWindow = $currentForegroundWindow
  } elseif ($shouldPreventFocus -and $currentForegroundWindow -eq $testWindow -and
      $lastForegroundWindow -ne [IntPtr]::Zero -and
      [TestWindowNativeMethods]::IsWindow($lastForegroundWindow)) {
    [TestWindowNativeMethods]::SetForegroundWindow($lastForegroundWindow) | Out-Null
  }

  [TestWindowNativeMethods]::SetWindowPos(
    $testWindow,
    [IntPtr]::Zero,
    $absoluteX,
    $absoluteY,
    $Width,
    $Height,
    ($SwpNoZOrder -bor $SwpNoActivate -bor $SwpAsyncWindowPos)) | Out-Null
  Start-Sleep -Milliseconds 50
  $testProcess.Refresh()
}
