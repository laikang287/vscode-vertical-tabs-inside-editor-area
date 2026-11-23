# Onglets verticaux dans la zone d’édition

[English](README.md) · [简体中文（规范源）](README.zh-CN.md) · [繁體中文](docs/README.zh-TW.md) · [日本語](docs/README.ja.md) · [한국어](docs/README.ko.md) · [Español](docs/README.es.md) · [Français](docs/README.fr.md) · [Deutsch](docs/README.de.md) · [Русский](docs/README.ru.md)

Affiche une <mark>barre d’onglets verticale</mark> sur le <mark>côté gauche de la zone d’édition</mark> sans utiliser la barre latérale principale ni la barre latérale secondaire de VS Code, ce qui lui permet de rester visible en permanence.

```text
Barre latérale principale | Onglets verticaux | Zone d’édition | Barre latérale secondaire
```

## Demo

![](../media/demo.gif)

## Démarrage rapide

- Installez l’extension depuis la marketplace VS Code :
  - https://marketplace.visualstudio.com/items?itemName=laikang287.vertical-tabs-inside-editor-area
  - Remarque : pour les IDE dérivés de VS Code, comme Cursor, VSCodium, Google Antigravity et Qoder, téléchargez l’extension depuis [Vertical Tabs Inside Editor Area – Open VSX Registry](https://open-vsx.org/extension/laikang287/vertical-tabs-inside-editor-area)
- Redémarrez VS Code.
- Cliquez sur l’un des deux boutons ci-dessous pour afficher ou masquer les onglets verticaux :
  - ![](../assets/README.zh-CN/demo2.png)

## Points forts

- Les onglets verticaux facilitent le travail avec de nombreux fichiers ouverts.
- La barre reste visible à <mark>gauche de la zone d’édition</mark> sans occuper les barres latérales.

## Fonctionnalités

- **Afficher les onglets verticaux à gauche de la zone d’édition**
- Prise en charge de plusieurs langues (i18n)
- Regroupement par groupes natifs VS Code, groupes manuels, type de fichier ou dossier parent
- Tri manuel, par nom ou par date
- Afficher ou masquer les onglets verticaux
- Opérations de base :
  - Glisser vers un groupe
  - Fermer par lot
  - Tout développer
  - Tout réduire
  - Épingler les onglets ou groupes par clic droit
  - Déplacer par lot (Shift permet la sélection multiple)
- Lors du regroupement par dossier parent, glisser un fichier vers un autre groupe déplace le fichier réel.
- Configurez la barre à gauche ou à droite et les boutons de recherche, paramètres et autres en haut ou en bas.

## Changer la langue de l’interface

Modifiez `verticalTabs.language` pour changer la langue. La valeur par défaut est `auto`.

## Remarques

1. Développé avec l’aide d’un LLM.
2. README.zh-CN.md est maintenu manuellement ; les autres README sont traduits par un LLM.

## Licence

MIT License - voir [LICENSE](../LICENSE)

## Problèmes connus

- Après l’installation ou la mise à jour d’une autre extension, les onglets verticaux peuvent parfois ne plus répondre aux clics. Redémarrez VS Code.
  - Exemple 1 : la mise à jour de cette extension peut aussi provoquer ce problème.
  - Exemple 2 : l’installation ou la mise à jour de l’extension VIM (projet VSCodeVim) peut le provoquer.
