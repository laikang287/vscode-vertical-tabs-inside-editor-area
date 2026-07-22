
# Vertikale Tabs im Editorbereich


[English](README.md) · [简体中文（规范源）](README.zh-CN.md) · [繁體中文](docs/README.zh-TW.md) · [日本語](docs/README.ja.md) · [한국어](docs/README.ko.md) · [Español](docs/README.es.md) · [Français](docs/README.fr.md) · [Deutsch](docs/README.de.md) · [Русский](docs/README.ru.md)

Zeigt eine stets sichtbare <mark>vertikale Tableiste</mark> auf der <mark>linken Seite des Editorbereichs</mark> an, ohne die primäre oder sekundäre Seitenleiste zu belegen.

Das Interface-Layout ist wie folgt:

```text
Primäre Seitenleiste | Vertikale Tableiste | Editorbereich | Sekundäre Seitenleiste
```

## Demo

![demo.gif](media/demo.gif)

## Warum Diese Erweiterung

VS Code verwendet standardmäßig eine horizontale Tableiste. Bei vielen geöffneten Dateien werden Tab-Namen leicht abgeschnitten, was das Finden und Wechseln von Dateien unübersichtlich macht.

Viele vertikale Tab-Erweiterungen platzieren die Tab-Liste in der primären Seitenleiste, aber diese muss auch den Datei-Explorer, die Suche, die Quellcodeverwaltung, Erweiterungen und andere Funktionen anzeigen.

Wenn Benutzer die Seitenleistenfunktion wechseln, werden auch die vertikalen Tabs ausgeblendet.

Diese Erweiterung platziert die vertikale Tableiste auf der linken Seite des Editorbereichs, sodass sie auch beim Wechseln anderer Funktionen in der primären Seitenleiste sichtbar bleibt.

## Für Wen Ist Es

- Für alle, die häufig mit vielen gleichzeitig geöffneten Dateien arbeiten
- Für alle mit ausreichend horizontalem Bildschirmplatz
- Für alle, die nicht möchten, dass vertikale Tabs die primäre Seitenleiste belegen

## Funktionen

- **Zeigt vertikale Tabs auf der linken Seite des Editorbereichs an**
- Mehrsprachige Unterstützung (i18n)
- Tab-Gruppen, einschließlich automatischer und manueller Gruppierung (nach Typ, nach übergeordnetem Verzeichnis oder der horizontalen Tableiste von VS Code folgend)
- Tab-Sortierung: manuell, nach Name, nach Zeit
- Vertikale Tableiste ein-/ausblenden
- Grundlegende Tab-Operationen:
	- Ziehen zum Gruppieren
	- Stapelweises Schließen
	- Alle ausklappen
	- Alle einklappen
	- Rechtsklick zum Anheften von Tabs und Tab-Gruppen
	- Stapelweises Verschieben (Shift-Taste für Mehrfachauswahl)
- Wenn der Gruppentyp "übergeordnetes Verzeichnis" ist, wird beim Ziehen einer Datei in eine andere Gruppe die tatsächliche Datei auf der Festplatte verschoben

## Schnellstart

- Suchen Sie im VS Code Extension Marketplace nach "Vertical Tabs Inside Editor Area" und installieren Sie die Erweiterung. Die Erweiterungs-ID lautet `laikang287.vertical-tabs-inside-editor-area`
- Starten Sie VS Code neu
- Finden Sie das `VERTICAL TABS`-Symbol in der Aktivitätsleiste von VS Code und klicken Sie darauf, um die Ansicht zu öffnen. Verwenden Sie Show/Hide, um die vertikale Tableiste ein- oder auszublenden
- Hinweis 1: Sie können die `VERTICAL TABS`-Ansicht an andere häufig genutzte Stellen in der Aktivitätsleiste verschieben
	- Siehe die Demo-GIF oben
- Hinweis 2: Es wird empfohlen, den Zeilenumbruch der Tabs von VS Code bei Verwendung dieser Erweiterung zu deaktivieren:

```json
{
  "workbench.editor.wrapTabs": false
}
```

## So Ändern Sie die Oberflächensprache

Die Konfigurationsoption `verticalTabs.language` ermöglicht das Umschalten der Sprache der Erweiterung. Der Standardwert ist `auto`.

## Funktionsweise

Beim Start erstellt die Erweiterung ein Webview und platziert es in einer separaten Editorgruppe ganz links im Editorbereich.

Dieses Webview wird zur Anzeige der vertikalen Tabs verwendet.

Die Erweiterung verwendet anschließend die Editorgruppen-Sperrfunktion von VS Code, um diese Gruppe zu sperren und zu verhindern, dass später geöffnete neue Dateien in die von der vertikalen Tableiste belegte Editorgruppe gelangen.

## Hinweise

1. Dieses Projekt hat während der Entwicklung KI-Programmierwerkzeuge verwendet, um das Schreiben von Code, Tests und die Dokumentation zu unterstützen
2. Die Dokumentation basiert auf README.zh-CN; Versionen in anderen Sprachen sind KI-Übersetzungen
3. Die vereinfachte chinesische Dokumentation ist die primär gepflegte Version dieses Projekts

## Lizenz

MIT-Lizenz - siehe [LICENSE](LICENSE)

## Manuelle Installation

- Finden Sie die neueste `.vsix`-Datei im releases-Verzeichnis des [vscode-vertical-tabs-inside-editor-area](https://github.com/laikang287/vscode-vertical-tabs-inside-editor-area/tree/main/releases) GitHub-Repositories und laden Sie sie herunter
- Öffnen Sie VS Code, gehen Sie zur Erweiterungsansicht in der Aktivitätsleiste, klicken Sie auf das Drei-Punkte-Menü oben rechts in der Seitenleiste und wählen Sie "Von VSIX installieren..."
