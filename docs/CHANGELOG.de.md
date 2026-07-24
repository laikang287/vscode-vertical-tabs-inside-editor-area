# Änderungsprotokoll

[English](CHANGELOG.md) · [简体中文（规范源）](CHANGELOG.zh-CN.md) · [繁體中文](docs/CHANGELOG.zh-TW.md) · [日本語](docs/CHANGELOG.ja.md) · [한국어](docs/CHANGELOG.ko.md) · [Español](docs/CHANGELOG.es.md) · [Français](docs/CHANGELOG.fr.md) · [Deutsch](docs/CHANGELOG.de.md) · [Русский](docs/CHANGELOG.ru.md)

## [1.0.0] - 2026-07-23

<mark>Dies ist eine umfangreiche Aktualisierung. Aufgrund der vielen Änderungen sollten Sie bei Fehlern eine Rückkehr zu Version 0.2.1 in Betracht ziehen.</mark>

### Wichtigste Funktionen

- <mark>Das Kontextmenü der vertikalen Tabs kann alle Schaltflächen anzeigen, die in den horizontalen Tabs von VS Code verfügbar sind, einschließlich der von VS Code selbst und von Drittanbieter-Erweiterungen bereitgestellten Schaltflächen.</mark>
- Der Stil der Benutzeroberfläche wurde aktualisiert, damit er besser zu VS-Code-Designs passt.
- Arbeitssets können gespeichert und geladen werden.
- Die vertikalen Tabs können links oder rechts angeordnet werden.
- Die Suchfunktion wurde erweitert.
- Die Einstellung `verticalTabs.relativePathDisplay` wurde hinzugefügt. Sie steuert, wann ein Pfad im Tab angezeigt wird, beispielsweise der übergeordnete Verzeichnisname nur bei Dateien mit gleichem Namen.
- Mehrere konfigurierbare Tastenkürzel zum Wechseln und Verschieben von Tabs sowie für weitere Aktionen wurden hinzugefügt.
    - Einzelheiten finden Sie in den Beschreibungen der Tastenkürzel.
    - Standardmäßig sind keine Tastenkürzel zugewiesen; weisen Sie sie bei Bedarf selbst zu.
    - `verticalTabs.previousAcrossGroups` und `verticalTabs.nextAcrossGroups` wechseln gruppenübergreifend zum vorherigen bzw. nächsten Tab. <mark>Diese beiden Befehle werden sehr häufig verwendet. Es empfiehlt sich, sie `Ctrl+Tab` und `Ctrl+Shift+Tab` zuzuweisen und damit die Standardkürzel von VS Code zu überschreiben.</mark>
- Mehrere Einstellungen wurden hinzugefügt; Einzelheiten finden Sie in den jeweiligen Beschreibungen.

### Integration des nativen VS-Code-Kontextmenüs

- Das Kontextmenü eines Tabs kann jetzt Aktionen anzeigen, die VS Code selbst und andere Erweiterungen im nativen Menü der Editor-Tabs registrieren.
- Die Einstellung `verticalTabs.showNativeContextMenuActions` wurde hinzugefügt, um die nativen Kontextmenüaktionen von VS Code zu aktivieren oder zu deaktivieren. Sie ist standardmäßig aktiviert.
- Native Untermenüs können per Tastatur geöffnet und bedient werden.
- Hinweis:

### Tabsuche und Navigation

- Eine Echtzeitsuche für Tabs mit Filterung nach Tabname wurde hinzugefügt.
- Optional können relative Arbeitsbereichspfade durchsucht und übereinstimmende Pfade in den Ergebnissen angezeigt und hervorgehoben werden.
- Die Suche mit regulären Ausdrücken wird unterstützt. Ein ungültiger regulärer Ausdruck zeigt einen Fehler an, ohne die aktuelle Liste zu beeinträchtigen.
- Die Anzahl der übereinstimmenden Tabs und Gruppen wird angezeigt und gefundener Text hervorgehoben.
- Während der Suche werden Gruppen mit Treffern automatisch erweitert; beim Leeren der Suche wird ihr vorheriger eingeklappter Zustand wiederhergestellt.

### Pfadanzeige und Unterscheidung gleichnamiger Dateien

Die Einstellung `verticalTabs.relativePathDisplay` bietet nun fünf Modi:

- Keine Pfade anzeigen.
- Nur bei gleichnamigen Dateien den Namen des übergeordneten Verzeichnisses anzeigen.
- Nur bei gleichnamigen Dateien den relativen Arbeitsbereichspfad anzeigen.
- Bei allen Dateien immer den Namen des übergeordneten Verzeichnisses anzeigen.
- Bei allen Dateien immer den relativen Arbeitsbereichspfad anzeigen.

Der Pfad wird unter dem Tabnamen angezeigt. Dateien im Stammverzeichnis des Arbeitsbereichs und Dateien außerhalb des Arbeitsbereichs verwenden erkennbare Informationen zum übergeordneten Verzeichnis als zusätzlichen Kontext.

### Tabnavigation, Sortierung und Verschieben

- Der Sortiermodus „Zuletzt verwendet“ wurde hinzugefügt. Er sortiert Tabs global nach dem Zeitpunkt ihrer letzten erfolgreichen Aktivierung in MRU-Reihenfolge.
- Neu geöffnete und aktivierte Tabs werden zu den zuletzt verwendeten Elementen; noch nicht aktivierte Tabs behalten eine stabile Reihenfolge.
- Die Einstellung „Aktivem Tab immer folgen“ wurde hinzugefügt: Nach einem Editorwechsel wird die zugehörige Gruppe automatisch erweitert und der aktive Tab in den sichtbaren Bereich gescrollt.
- Acht konfigurierbare Befehle wurden hinzugefügt:
    - Zum vorherigen oder nächsten Tab innerhalb einer Gruppe wechseln.
    - Gruppenübergreifend zum vorherigen oder nächsten Tab wechseln.
    - Tabs innerhalb der aktuellen Gruppe nach oben oder unten verschieben.
    - Tabs in die vorherige oder nächste Gruppe verschieben.
- Verschiebebefehle unterstützen Mehrfachauswahl und bewahren die relative Reihenfolge der ausgewählten Tabs.
- Die manuelle Sortierung unterstützt das Verschieben innerhalb einer Gruppe. Bei der Verzeichnisgruppierung können Dateien zwischen Gruppen verschoben werden, während die Dateitypgruppierung gruppenübergreifende Verschiebungen blockiert, die der Gruppierungsregel widersprechen.

### Arbeitssets und Sitzungswiederherstellung

- Arbeitsbereichsbezogene Arbeitssets wurden hinzugefügt. Sie können Folgendes speichern:
    - Die derzeit geöffneten Tabs.
    - Native Editorgruppen und die Reihenfolge ihrer Tabs.
    - Den aktiven Tab.
    - Manuelle Gruppen und manuelle Sortierung.
    - Den angehefteten Zustand von Tabs und Tabgruppen.
    - Den eingeklappten Zustand von Gruppen.
    - Die aktuellen Gruppierungs- und Sortiermodi.
- Arbeitssets können über die Befehlspalette oder die vertikale Tableiste erstellt, geladen, überschrieben, umbenannt und gelöscht werden.
- Vor dem Laden führt die Erweiterung Tabs auf, die möglicherweise geschlossen werden, sowie nicht gespeicherte Tabs. Nicht gespeicherte und angeheftete Tabs sind standardmäßig geschützt.
- Fehlt ein ursprünglicher Pfad, wird er nur dann automatisch zugeordnet, wenn im Arbeitsbereich genau eine gleichnamige Datei vorhanden ist. Dadurch werden falsche Wiederherstellungen vermieden.

### Anzeige des Tabstatus

- Hinweis: Dieser Bereich wurde noch nicht vollständig getestet.
- Schreibgeschützte Ressourcenzustände wurden hinzugefügt, darunter schreibgeschützte Dateisysteme, schreibgeschützte Berechtigungen und die Schreibschutzregeln von VS Code.
- Zustände für nicht vorhandene Ressourcen, fehlende Zugriffsrechte und nicht verfügbare Dateisysteme wurden hinzugefügt.
- Der Zustand wird aktualisiert, nachdem Dateien gelöscht oder wiederhergestellt wurden oder sich Berechtigungen bzw. Schreibschutzeinstellungen geändert haben.
- Auf der rechten Seite eines Tabs werden die Zustände Vorschau, angeheftet, schreibgeschützt, nicht gespeichert, Ressourcenfehler und Navigation nicht verfügbar einheitlich angezeigt.
- Der Status „nicht gespeichert“ wird in der Nähe der Schließen-Schaltfläche gebündelt.
- Für den Tabtext steht mehr Breite zur Verfügung. Die Schließen-Schaltfläche wird nur beim Darüberfahren mit der Maus oder beim Eintritt des Tastaturfokus in den Tab angezeigt.

### Layout, Position und Einstiegspunkte

- `verticalTabs.position` wurde hinzugefügt, um die vertikale Tableiste links oder rechts im Editorbereich zu platzieren und die Änderung sofort anzuwenden.
- `verticalTabs.toolbarPosition` wurde hinzugefügt, um den Werkzeugbereich oberhalb oder unterhalb der Tabliste zu fixieren.
- Rechts in der Statusleiste wurde eine dauerhaft sichtbare Schaltfläche zum Ein- und Ausblenden hinzugefügt. Ihr Symbol ändert sich je nach Position und Sichtbarkeit der Tableiste.
- Die endgültige Benutzeroberfläche verwendet VS-Code-Designfarben und Codicon-Aktionsschaltflächen.

### Tastatur und Barrierefreiheit

- Befindet sich der Fokus in einem leeren Bereich der vertikalen Tabs, können Tabs mit den Pfeiltasten, `Home`, `End` und `Enter` durchlaufen und aktiviert werden.
    - Der praktische Nutzen ist begrenzt: Nachdem ein Tab per Tastatur verschoben oder aktiviert wurde, wechselt der Fokus in den Tab, sodass die Navigation innerhalb der vertikalen Tabs nicht fortgesetzt werden kann.
- Tab- und Gruppenmenüs unterstützen die Menütaste, `Shift+F10`, die Pfeiltasten, `Enter`, die Leertaste und `Esc`.

## [0.2.1] - 2026-07-23

Die aktualisierte README wurde in die Version aufgenommen.

## [0.2.0] - 2026-07-23

Die erste Version wurde fertiggestellt.
