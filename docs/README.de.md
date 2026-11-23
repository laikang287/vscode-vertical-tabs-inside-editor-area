# Vertikale Tabs im Editorbereich

[English](README.md) · [简体中文（规范源）](README.zh-CN.md) · [繁體中文](docs/README.zh-TW.md) · [日本語](docs/README.ja.md) · [한국어](docs/README.ko.md) · [Español](docs/README.es.md) · [Français](docs/README.fr.md) · [Deutsch](docs/README.de.md) · [Русский](docs/README.ru.md)

Zeigt auf der <mark>linken Seite des Editorbereichs</mark> eine <mark>vertikale Tableiste</mark> an, ohne die primäre oder die sekundäre Seitenleiste von VS Code zu verwenden, sodass die Tableiste dauerhaft sichtbar bleiben kann.

```text
Primäre Seitenleiste | Vertikale Tableiste | Editorbereich | Sekundäre Seitenleiste
```

## Demo

![](../media/demo.gif)

## Schnellstart

- Installiere die Erweiterung aus dem VS-Code-Marketplace:
  - https://marketplace.visualstudio.com/items?itemName=laikang287.vertical-tabs-inside-editor-area
  - Hinweis: Für VS-Code-basierte IDEs wie Cursor, VSCodium, Google Antigravity und Qoder kannst du die Erweiterung hier herunterladen: [Vertical Tabs Inside Editor Area – Open VSX Registry](https://open-vsx.org/extension/laikang287/vertical-tabs-inside-editor-area)
- Starte VS Code neu.
- Klicke auf eine der beiden Schaltflächen, um die vertikalen Tabs ein- oder auszublenden:
  - ![](../assets/README.zh-CN/demo2.png)

## Besonderheiten

- Vertikale Tabs erleichtern die Arbeit mit vielen geöffneten Dateien.
- Die Tableiste bleibt <mark>links im Editorbereich</mark> sichtbar und belegt keine Seitenleiste.

## Funktionen

- **Vertikale Tabs links im Editorbereich anzeigen**
- Mehrsprachige Oberfläche (i18n)
- Gruppierung nach nativen VS-Code-Gruppen, manuellen Gruppen, Dateityp oder übergeordnetem Verzeichnis
- Manuelle Sortierung sowie Sortierung nach Name oder Zeit
- Vertikale Tabs ein- und ausblenden
- Grundfunktionen:
  - Per Drag-and-drop gruppieren
  - Mehrere Tabs schließen
  - Alle ausklappen
  - Alle einklappen
  - Tabs oder Gruppen per Rechtsklick anheften
  - Mehrere Tabs verschieben (mit Shift mehrfach auswählen)
- Bei Gruppierung nach übergeordnetem Verzeichnis verschiebt das Ziehen in eine andere Gruppe die tatsächliche Datei.
- Die Tableiste kann links oder rechts und die Schaltflächen für Suche, Einstellungen usw. oben oder unten angezeigt werden.

## Oberflächensprache ändern

Mit `verticalTabs.language` wird die Sprache geändert. Der Standardwert ist `auto`.

## Hinweise

1. Mit Unterstützung eines LLM entwickelt.
2. README.zh-CN.md wird manuell gepflegt; die übrigen READMEs werden von einem LLM übersetzt.

## Lizenz

MIT License – siehe [LICENSE](../LICENSE)

## Bekannte Probleme

- Nach der Installation oder Aktualisierung anderer Erweiterungen lassen sich vertikale Tabs manchmal nicht anklicken. Starte VS Code neu.
  - Beispiel 1: Auch die Aktualisierung dieser Erweiterung kann das Problem auslösen.
  - Beispiel 2: Die Installation oder Aktualisierung der VIM-Erweiterung (Projekt VSCodeVim) kann es auslösen.
