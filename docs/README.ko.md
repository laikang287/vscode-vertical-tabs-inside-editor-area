
# 편집기 영역 세로 탭


[English](README.md) · [简体中文（规范源）](README.zh-CN.md) · [繁體中文](docs/README.zh-TW.md) · [日本語](docs/README.ja.md) · [한국어](docs/README.ko.md) · [Español](docs/README.es.md) · [Français](docs/README.fr.md) · [Deutsch](docs/README.de.md) · [Русский](docs/README.ru.md)

VS Code <mark>편집기 영역 왼쪽</mark>에 항상 표시되는 <mark>세로 탭 막대</mark>를 표시하며, 기본 사이드바와 보조 사이드바를 차지하지 않습니다.

인터페이스 레이아웃은 다음과 같습니다:

```text
기본 사이드바 | 세로 탭 막대 | 편집기 영역 | 보조 사이드바
```

## 데모

![demo.gif](media/demo.gif)

## 이 확장을 개발한 이유

VS Code는 기본적으로 가로 탭 막대를 사용합니다. 많은 파일을 열면 탭 이름이 잘리기 쉽고 파일을 찾고 전환하기가 직관적이지 않습니다.

많은 세로 탭 확장은 탭 목록을 기본 사이드바에 배치하지만, 기본 사이드바는 파일 탐색기, 검색, 소스 제어, 확장 기능도 표시해야 합니다.

사용자가 사이드바 기능을 전환하면 세로 탭도 함께 숨겨집니다.

이 확장은 세로 탭 막대를 편집기 영역 왼쪽에 배치하므로, 기본 사이드바에서 다른 기능으로 전환해도 세로 탭이 계속 표시됩니다.

## 대상 사용자

- 자주 많은 파일을 동시에 여는 분
- 화면에 충분한 가로 공간이 있는 분
- 세로 탭이 기본 사이드바를 차지하는 것을 원하지 않는 분

## 기능

- **편집기 영역 왼쪽에 세로 탭 표시**
- 다국어 지원 (i18n)
- 탭 그룹 지원, 자동 그룹화 및 수동 그룹화 포함 (유형별 그룹화, 상위 디렉터리별 그룹화, VS Code 가로 탭 막대 따라가기)
- 수동 정렬, 이름 정렬, 시간 정렬
- 세로 탭 막대 표시/숨기기
- 기본 탭 작업:
	- 드래그하여 그룹화
	- 일괄 닫기
	- 모두 펼치기
	- 모두 접기
	- 오른쪽 클릭으로 탭 및 탭 그룹 고정
	- 일괄 이동 (Shift 키로 다중 선택)
- 그룹 유형이 상위 디렉터리인 경우, 파일을 다른 그룹으로 드래그하면 실제 파일이 이동됩니다

## 빠른 시작

- VS Code 확장 마켓플레이스에서 "Vertical Tabs Inside Editor Area"를 검색하여 설치하세요. 확장의 Identifier는 `laikang287.vertical-tabs-inside-editor-area`입니다
- VS Code를 다시 시작하세요
- VS Code 활동 표시줄에서 `VERTICAL TABS` 아이콘을 찾아 클릭하여 보기를 열고, Show/Hide를 클릭하여 세로 탭 막대를 표시하거나 숨깁니다
- 참고 1: 이 `VERTICAL TABS` 보기는 활동 표시줄 내의 다른 자주 사용하는 위치로 이동할 수 있습니다
	- 위의 GIF에서 데모를 확인하세요
- 참고 2: 이 확장을 사용할 때는 VS Code의 탭 줄 바꿈 기능을 끄는 것이 좋습니다:

```json
{
  "workbench.editor.wrapTabs": false
}
```

## 인터페이스 언어 전환 방법

설정 항목 `verticalTabs.language`로 확장의 언어를 전환할 수 있습니다. 기본값은 `auto`입니다.

## 작동 원리

확장이 시작되면 Webview가 생성되어 편집기 영역의 가장 왼쪽에 있는 독립된 편집기 그룹에 배치됩니다.

이 Webview는 세로 탭을 표시하는 데 사용됩니다.

그런 다음 확장은 VS Code의 편집기 그룹 잠금 기능을 사용하여 해당 편집기 그룹을 잠그고, 이후에 열리는 새 파일이 세로 탭 막대가 있는 편집기 그룹에 들어가지 않도록 합니다.

## 참고 사항

1. 본 프로젝트는 개발 과정에서 AI 프로그래밍 도구를 활용하여 코드 작성, 테스트 및 문서 정리를 지원했습니다
2. 문서는 README.zh-CN을 기준으로 하며, 다른 언어 버전은 AI 번역입니다
3. 간체 중국어 문서가 본 프로젝트의 주요 유지 관리 버전입니다
4. 이 확장은 우회적인 방식으로 세로 탭을 구현하므로 임시방편에 가깝습니다. 가장 좋은 해결책은 VS Code가 세로 탭을 공식적으로 지원하는 것입니다.

	관련 VS Code 이슈에 추천을 눌러 VS Code 팀이 수요를 인식하고 이 기능을 더 중요하게 다루도록 도와주세요:

    [Add support for vertical tabs · Issue #108264 · microsoft/vscode](https://github.com/microsoft/vscode/issues/108264)

## 라이선스

MIT License - 자세한 내용은 [LICENSE](LICENSE)를 참조하세요

## 수동 설치 방법

- GitHub에서 `vscode-vertical-tabs-inside-editor-area` 저장소를 열고 releases 디렉터리에서 최신 `.vsix` 파일을 다운로드하세요
	- GitHub 저장소 주소: [vscode-vertical-tabs-inside-editor-area](https://github.com/laikang287/vscode-vertical-tabs-inside-editor-area/tree/main/releases)
- VS Code 열기 → 활동 표시줄에서 확장 보기 열기 → 사이드바 오른쪽 상단의 점 세 개 메뉴 클릭 → "VSIX에서 설치..." 선택
