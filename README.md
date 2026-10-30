# Poste de pilotage

Un tableau de bord pour faire travailler Claude Code sur plusieurs projets en parallèle, sans passer de l'un à l'autre : décisions à valider, alertes, file d'attente, quota de l'abonnement Max.

Il tourne sur le Mac (puis le Mac Mini), là où sont les dépôts et où Claude Code est connecté. Jamais chez l'hébergeur.

## Où on en est

- `maquette/` : maquette cliquable, données d'exemple, rien de branché. Ouvrir `maquette/index.html` dans le navigateur.
- Version en ligne (privée) : https://claude.ai/artifact/Cxvak7PfRL7ASovrExkBQe

## La suite

1. Le chef d'orchestre (petit serveur local) et l'audit de nuit en lecture seule sur tous les projets.
2. Les tâches qui écrivent du code, jusqu'à la PR, validées depuis l'interface.
3. La mise en prod depuis l'interface, projet par projet, toujours sur feu vert.
