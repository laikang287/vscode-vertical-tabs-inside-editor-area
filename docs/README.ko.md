# 편집기 영역의 세로 탭

[English](README.md) · [简体中文（规范源）](README.zh-CN.md) · [繁體中文](docs/README.zh-TW.md) · [日本語](docs/README.ja.md) · [한국어](docs/README.ko.md) · [Español](docs/README.es.md) · [Français](docs/README.fr.md) · [Deutsch](docs/README.de.md) · [Русский](docs/README.ru.md)

VS Code의 <mark>편집기 영역 왼쪽</mark>에 <mark>세로 탭 표시줄</mark>을 표시합니다. 기본 및 보조 사이드바를 사용하지 않으므로 탭 표시줄을 항상 표시해 둘 수 있습니다.

```text
기본 사이드바 | 세로 탭 표시줄 | 편집기 영역 | 보조 사이드바
```

## Demo

![](../media/demo.gif)

## 빠른 시작

- VS Code 확장 마켓플레이스에서 설치합니다:
  - https://marketplace.visualstudio.com/items?itemName=laikang287.vertical-tabs-inside-editor-area
  - 참고: Cursor, VSCodium, Google Antigravity, Qoder 등 VS Code 기반 IDE에서는 Open VSX에서 다운로드할 수 있습니다: [Vertical Tabs Inside Editor Area – Open VSX Registry](https://open-vsx.org/extension/laikang287/vertical-tabs-inside-editor-area)
- VS Code를 다시 시작합니다.
- 아래 두 버튼 중 하나를 클릭하여 세로 탭을 표시하거나 숨깁니다:
  - ![](../assets/README.zh-CN/demo2.png)

## 확장 기능의 특징

- 세로 탭으로 많은 파일을 편리하게 열어 둘 수 있습니다.
- 사이드바를 사용하지 않고 <mark>편집기 영역 왼쪽</mark>에 표시되어 항상 볼 수 있습니다.

## 기능

- **편집기 영역 왼쪽에 세로 탭 표시**
- 다국어 지원(i18n)
- VS Code 기본 그룹, 수동 그룹, 파일 유형 또는 상위 디렉터리별 그룹화
- 수동, 이름 또는 시간순 정렬
- 세로 탭 표시 및 숨기기
- 기본 탭 기능:
  - 드래그하여 그룹화
  - 일괄 닫기
  - 모두 펼치기
  - 모두 접기
  - 마우스 오른쪽 버튼으로 탭 또는 그룹 고정
  - 일괄 이동(Shift 키로 다중 선택)
- 상위 디렉터리로 그룹화할 때 파일을 다른 그룹으로 드래그하면 실제 파일이 이동합니다.
- 탭 표시줄을 왼쪽이나 오른쪽에, 검색 및 설정 등의 버튼을 위나 아래에 배치할 수 있습니다.

## 인터페이스 언어 변경

`verticalTabs.language`로 언어를 변경합니다. 기본값은 `auto`입니다.

## 참고

1. LLM의 도움을 받아 개발했습니다.
2. README.zh-CN.md는 수동으로 관리하며 나머지 README는 LLM이 번역합니다.

## 라이선스

MIT License - [LICENSE](../LICENSE) 참조

## 알려진 문제

- 다른 확장을 설치하거나 업데이트한 후 세로 탭이 클릭되지 않을 수 있습니다. VS Code를 다시 시작하면 됩니다.
  - 예 1: 이 확장을 업데이트할 때도 가끔 발생합니다.
  - 예 2: VIM 확장(VSCodeVim 프로젝트)을 설치하거나 업데이트하면 발생할 수 있습니다.
