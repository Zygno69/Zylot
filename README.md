# Zylot

Un tableau de bord pour faire travailler Claude Code sur plusieurs projets en parallèle, sans passer de l'un à l'autre : décisions à valider, alertes, journal.

Il tourne sur le Mac (puis le Mac Mini), là où sont les dépôts et où Claude Code est connecté. Jamais chez l'hébergeur. Il utilise l'abonnement Claude (la commande `claude`), pas l'API.

## Ce qui marche (palier 1)

- **Audit de nuit en lecture seule** sur les projets de `projets.json` : sécurité du code, dépendances, site en ligne et certificat, état du dépôt, propositions. L'agent n'a le droit que de lire (voir `coeur/audit.js`) ; les réglages propres à chaque projet et les connecteurs sont ignorés.
- **Interface** sur http://localhost:4000 : alertes à décider, état de chaque projet, rapport complet, journal, lancement d'un audit à la main.
- **Notifications** sur le Mac ; sur le téléphone avec [ntfy](https://ntfy.sh) si un sujet est mis dans `config.local.json`.

## Installer

```bash
cp config.local.example.json config.local.json   # facultatif : port, modèle, sujet ntfy
./installer/installer.sh                         # serveur toujours allumé + audit à 1 h
```

Retirer : `./installer/installer.sh retirer`. Audit à la main : `node nuit.js` (tous) ou `node nuit.js lmo plan2`.

La commande `claude` doit être connectée au compte (`claude`, puis `/login` si besoin) : c'est sa connexion que les agents utilisent, pas celle de l'appli de bureau.

## Où sont les choses

- `projets.json` : la liste des projets (dossier, site).
- `donnees/` : rapports, alertes, journal, logs. Hors git : ça peut décrire des failles.
- `maquette/` : la maquette d'origine, données d'exemple.

## La suite

1. ~~Le chef d'orchestre et l'audit de nuit en lecture seule.~~
2. Les tâches qui écrivent du code, jusqu'à la PR, validées depuis l'interface.
3. La mise en prod depuis l'interface, projet par projet, toujours sur feu vert.
