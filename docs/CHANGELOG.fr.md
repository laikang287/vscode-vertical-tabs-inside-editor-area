# Journal des modifications

[English](CHANGELOG.md) · [简体中文（规范源）](CHANGELOG.zh-CN.md) · [繁體中文](docs/CHANGELOG.zh-TW.md) · [日本語](docs/CHANGELOG.ja.md) · [한국어](docs/CHANGELOG.ko.md) · [Español](docs/CHANGELOG.es.md) · [Français](docs/CHANGELOG.fr.md) · [Deutsch](docs/CHANGELOG.de.md) · [Русский](docs/CHANGELOG.ru.md)

## [1.0.0] - 2026-07-23

<mark>Il s'agit d'une mise à jour majeure. En raison du grand nombre de changements, envisagez de revenir à la version 0.2.1 si vous rencontrez des bogues.</mark>

### Fonctionnalités principales

- <mark>Le menu contextuel des onglets verticaux peut afficher tous les boutons disponibles dans les onglets horizontaux de VS Code, y compris ceux de VS Code et ceux fournis par des extensions tierces.</mark>
- Le style de l'interface a été mis à jour pour mieux correspondre aux thèmes de VS Code.
- Il est désormais possible d'enregistrer et de charger des ensembles de travail.
- Les onglets verticaux peuvent être placés à gauche ou à droite.
- La fonction de recherche a été améliorée.
- Le paramètre `verticalTabs.relativePathDisplay` a été ajouté. Il contrôle les conditions d'affichage d'un chemin dans l'onglet, par exemple l'affichage du répertoire parent uniquement pour les fichiers portant le même nom.
- Plusieurs raccourcis configurables ont été ajoutés pour changer et déplacer les onglets, entre autres opérations.
    - Consultez la description des raccourcis clavier pour plus de détails.
    - Aucun raccourci n'est attribué par défaut ; configurez-les selon vos besoins.
    - `verticalTabs.previousAcrossGroups` et `verticalTabs.nextAcrossGroups` permettent de passer à l'onglet précédent ou suivant entre les groupes. <mark>Ces deux commandes sont très fréquemment utilisées. Il est recommandé de les attribuer à `Ctrl+Tab` et `Ctrl+Shift+Tab`, en remplaçant les raccourcis par défaut de VS Code.</mark>
- Plusieurs paramètres ont été ajoutés ; consultez leur description pour plus de détails.

### Intégration au menu contextuel natif de VS Code

- Le menu contextuel d'un onglet peut désormais afficher les actions que VS Code et d'autres extensions enregistrent dans le menu natif des onglets de l'éditeur.
- Le paramètre `verticalTabs.showNativeContextMenuActions` a été ajouté pour activer ou désactiver les actions du menu contextuel natif de VS Code. Il est activé par défaut.
- Les sous-menus natifs peuvent être ouverts et utilisés au clavier.
- Remarque :

### Recherche et localisation des onglets

- Une recherche d'onglets en temps réel permettant de filtrer par nom a été ajoutée.
- La recherche peut inclure les chemins relatifs à l'espace de travail, qui sont alors affichés et mis en évidence dans les résultats.
- La recherche par expression régulière est prise en charge. Une expression non valide affiche une erreur sans perturber la liste actuelle.
- Le nombre d'onglets et de groupes correspondants est affiché, et le texte trouvé est mis en évidence.
- Pendant une recherche, les groupes contenant des résultats sont automatiquement développés ; leur état replié précédent est restauré lorsque la recherche est effacée.

### Affichage des chemins et distinction des fichiers de même nom

Le paramètre `verticalTabs.relativePathDisplay` propose désormais cinq modes :

- Ne pas afficher les chemins.
- Afficher le répertoire parent uniquement pour les fichiers de même nom.
- Afficher le chemin relatif à l'espace de travail uniquement pour les fichiers de même nom.
- Toujours afficher le répertoire parent pour tous les fichiers.
- Toujours afficher le chemin relatif à l'espace de travail pour tous les fichiers.

Le chemin apparaît sous le nom de l'onglet. Les fichiers situés à la racine de l'espace de travail et ceux situés à l'extérieur utilisent des informations reconnaissables sur le répertoire parent comme contexte supplémentaire.

### Navigation, tri et déplacement des onglets

- Un mode de tri « Récemment utilisés » a été ajouté. Il trie globalement les onglets selon le principe MRU, d'après leur dernière activation réussie.
- Les onglets nouvellement ouverts et activés deviennent les éléments les plus récemment utilisés ; les onglets qui n'ont pas encore été activés conservent un ordre stable.
- Le paramètre « Toujours suivre l'onglet actif » a été ajouté : lors d'un changement d'éditeur, le groupe correspondant se développe automatiquement et l'onglet actif défile jusqu'à devenir visible.
- Huit commandes configurables ont été ajoutées :
    - Accéder à l'onglet précédent ou suivant dans un groupe.
    - Accéder à l'onglet précédent ou suivant entre les groupes.
    - Déplacer un onglet vers le haut ou le bas dans le groupe actuel.
    - Déplacer un onglet vers le groupe précédent ou suivant.
- Les commandes de déplacement prennent en charge la sélection multiple et conservent l'ordre relatif des onglets sélectionnés.
- Le tri manuel permet les déplacements dans un groupe. Le regroupement par répertoire permet de déplacer les fichiers entre les groupes, tandis que le regroupement par type de fichier bloque les déplacements incompatibles avec la règle de regroupement.

### Ensembles de travail et restauration de session

- Des ensembles de travail limités à l'espace de travail ont été ajoutés et peuvent enregistrer :
    - Les onglets actuellement ouverts.
    - Les groupes natifs de l'éditeur et l'ordre des onglets.
    - L'onglet actif.
    - Les groupes manuels et le tri manuel.
    - L'état épinglé des onglets et des groupes d'onglets.
    - L'état replié des groupes.
    - Les modes actuels de regroupement et de tri.
- Les ensembles de travail peuvent être créés, chargés, écrasés, renommés et supprimés depuis la palette de commandes ou la barre d'onglets verticaux.
- Avant le chargement, l'extension répertorie les onglets susceptibles d'être fermés ainsi que les onglets non enregistrés. Les onglets non enregistrés et épinglés sont protégés par défaut.
- Si un chemin d'origine est introuvable, l'extension ne l'associe automatiquement que si l'espace de travail contient exactement un fichier du même nom, afin d'éviter une restauration incorrecte.

### Affichage de l'état des onglets

- Remarque : cette partie n'a pas encore été entièrement testée.
- Des états de ressource en lecture seule ont été ajoutés, notamment la lecture seule du système de fichiers, celle due aux autorisations et les règles de lecture seule de VS Code.
- Des états ont été ajoutés pour les ressources inexistantes, les autorisations d'accès insuffisantes et les systèmes de fichiers indisponibles.
- L'état est actualisé après la suppression ou la restauration d'un fichier, ou après une modification des autorisations ou des paramètres de lecture seule.
- Le côté droit d'un onglet affiche de manière uniforme les états aperçu, épinglé, lecture seule, non enregistré, erreur de ressource et navigation indisponible.
- L'état non enregistré est regroupé près du bouton de fermeture.
- Une plus grande largeur est disponible pour le texte de l'onglet. Le bouton de fermeture n'apparaît qu'au survol ou lorsque le focus clavier entre dans l'onglet.

### Disposition, position et points d'entrée

- `verticalTabs.position` a été ajouté pour placer la barre d'onglets verticaux à gauche ou à droite de la zone de l'éditeur et appliquer immédiatement le changement.
- `verticalTabs.toolbarPosition` a été ajouté pour fixer la zone d'outils au-dessus ou au-dessous de la liste des onglets.
- Un bouton permanent d'affichage/masquage a été ajouté à droite de la barre d'état. Son icône change selon la position et la visibilité de la barre d'onglets.
- L'interface finale utilise les couleurs du thème VS Code et des boutons d'action Codicon.

### Clavier et accessibilité

- Lorsque le focus se trouve dans une zone vide des onglets verticaux, les touches fléchées, `Home`, `End` et `Enter` permettent de parcourir et d'activer les onglets.
    - L'utilité pratique est limitée : après avoir déplacé ou activé un onglet au clavier, le focus entre dans l'onglet et il n'est plus possible de poursuivre la navigation dans les onglets verticaux.
- Les menus d'onglets et de groupes prennent en charge la touche Menu, `Shift+F10`, les touches fléchées, `Enter`, Espace et `Esc`.

## [0.2.1] - 2026-07-23

Le README mis à jour a été inclus dans la version.

## [0.2.0] - 2026-07-23

La version initiale a été achevée.
