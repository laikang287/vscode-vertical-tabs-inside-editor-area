
# Onglets Verticaux dans la Zone de l'Éditeur


[English](README.md) · [简体中文（规范源）](README.zh-CN.md) · [繁體中文](docs/README.zh-TW.md) · [日本語](docs/README.ja.md) · [한국어](docs/README.ko.md) · [Español](docs/README.es.md) · [Français](docs/README.fr.md) · [Deutsch](docs/README.de.md) · [Русский](docs/README.ru.md)

Affiche une <mark>barre d'onglets verticaux</mark> toujours visible sur le <mark>côté gauche de la zone de l'éditeur</mark>, sans occuper les barres latérales principale et secondaire.

La disposition de l'interface est la suivante :

```text
Barre latérale principale | Barre d'onglets verticaux | Zone de l'éditeur | Barre latérale secondaire
```

## Démo

![demo.gif](media/demo.gif)

## Pourquoi Cette Extension

VS Code utilise une barre d'onglets horizontale par défaut. Avec de nombreux fichiers ouverts, les noms d'onglets sont facilement tronqués, ce qui rend la recherche et le changement de fichiers peu intuitifs.

De nombreuses extensions d'onglets verticaux placent la liste d'onglets dans la barre latérale principale, mais celle-ci doit également afficher l'explorateur de fichiers, la recherche, le contrôle de code source, les extensions et d'autres fonctionnalités.

Lorsque les utilisateurs changent de fonction dans la barre latérale, les onglets verticaux sont également masqués.

Cette extension place la barre d'onglets verticaux à gauche de la zone de l'éditeur, de sorte qu'elle reste visible même en changeant d'autres fonctions dans la barre latérale principale.

## Public Cible

- Ceux qui travaillent fréquemment avec de nombreux fichiers ouverts simultanément
- Ceux qui disposent de suffisamment d'espace horizontal à l'écran
- Ceux qui ne souhaitent pas que les onglets verticaux occupent la barre latérale principale

## Fonctionnalités

- **Affiche les onglets verticaux à gauche de la zone de l'éditeur**
- Support multilingue (i18n)
- Groupes d'onglets, incluant le regroupement automatique et manuel (par type, par répertoire parent, ou en suivant la barre d'onglets horizontale de VS Code)
- Tri des onglets : manuel, par nom, par temps
- Afficher/masquer la barre d'onglets verticaux
- Opérations de base sur les onglets :
	- Glisser pour grouper
	- Fermeture par lot
	- Tout développer
	- Tout réduire
	- Clic droit pour épingler les onglets et les groupes d'onglets
	- Déplacement par lot (utilisez la touche Shift pour la sélection multiple)
- Lorsque le type de groupe est "répertoire parent", faire glisser un fichier vers un autre groupe déplace le fichier réel sur le disque

## Démarrage Rapide

- Recherchez "Vertical Tabs Inside Editor Area" dans le marketplace des extensions VS Code et installez-le. L'identifiant de l'extension est `laikang287.vertical-tabs-inside-editor-area`
- Redémarrez VS Code
- Trouvez l'icône `VERTICAL TABS` dans la barre d'activités de VS Code, cliquez pour ouvrir la vue. Utilisez Show/Hide pour afficher ou masquer la barre d'onglets verticaux
- Note 1 : Vous pouvez déplacer la vue `VERTICAL TABS` vers d'autres zones fréquemment utilisées de la barre d'activités
	- Voir le GIF de démonstration ci-dessus
- Note 2 : Il est recommandé de désactiver le retour à la ligne des onglets de VS Code lors de l'utilisation de cette extension :

```json
{
  "workbench.editor.wrapTabs": false
}
```

## Comment Changer la Langue de l'Interface

Le paramètre `verticalTabs.language` permet de changer la langue de l'extension. La valeur par défaut est `auto`.

## Fonctionnement

Au démarrage, l'extension crée un Webview et le place dans un groupe d'éditeur indépendant à l'extrême gauche de la zone de l'éditeur.

Ce Webview est utilisé pour afficher les onglets verticaux.

L'extension utilise ensuite la fonction de verrouillage de groupe d'éditeurs de VS Code pour verrouiller ce groupe, empêchant ainsi les nouveaux fichiers ouverts ultérieurement d'entrer dans le groupe d'éditeur occupé par la barre d'onglets verticaux.

## Remarques

1. Ce projet a utilisé des outils de programmation IA pendant le développement pour aider à la rédaction du code, aux tests et à la documentation
2. La documentation est basée sur README.zh-CN ; les versions dans d'autres langues sont des traductions IA
3. La documentation en chinois simplifié est la version principale maintenue de ce projet

## Licence

Licence MIT - voir [LICENSE](LICENSE)

## Installation Manuelle

- Trouvez le fichier `.vsix` le plus récent dans le répertoire releases du dépôt [vscode-vertical-tabs-inside-editor-area](https://github.com/laikang287/vscode-vertical-tabs-inside-editor-area/tree/main/releases) sur GitHub et téléchargez-le
- Ouvrez VS Code, allez dans la vue Extensions dans la barre d'activités, cliquez sur le menu à trois points en haut à droite de la barre latérale, et sélectionnez "Installer à partir d'un VSIX..."
