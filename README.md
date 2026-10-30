# Zylot

Un tableau de bord pour faire travailler Claude Code sur plusieurs projets en parallèle, sans passer de l'un à l'autre : décisions à valider, alertes, journal.

Il tourne sur le Mac (puis le Mac Mini), là où sont les dépôts et où Claude Code est connecté. Jamais chez l'hébergeur. Il utilise l'abonnement Claude (la commande `claude`), pas l'API.

## Ce qui marche (palier 1)

- **Audit hebdomadaire en lecture seule** (lundi à 1 h) sur les projets de `projets.json` : sécurité du code, dépendances, site en ligne et certificat, état du dépôt, propositions. L'agent n'a le droit que de lire (voir `coeur/audit.js`) ; les réglages propres à chaque projet et les connecteurs sont ignorés.
- **Interface** sur http://zylot.localhost:4000, en quatre onglets :
  - **Vue d'ensemble** : un voyant par projet (site, certificat, code, note de sécurité, liens), la liste « À regarder », le journal.
  - **Surveillance** (sans Claude, toutes les 5 min) : site en ligne, temps de réponse, disponibilité sur 24 h / 7 j / 30 j, certificat, pannes. Alerte au deuxième échec de suite.
  - **Sécurité** (sans Claude, chaque jour) : fichiers sensibles exposés (`.git`, `.env`, sauvegardes SQL…), redirection HTTPS, en-têtes de protection, note de A à E ; plus l'audit du code par Claude.
  - **Conversation avec Claude**, dans la fiche de chaque projet, comme dans un terminal : il lit, propose, et modifie une copie à part du projet (worktree, branche `zylot/…`) quand on lui dit « vas-y ». Pour toucher au vrai projet il passe par la commande `outils/zylot` : `garder` (commit + avance rapide) et `deployer` (commande `deploy` de projets.json, puis vérification du site), que le serveur n'accepte que si le dernier message du propriétaire le demande. Jamais de push.
  - **Propositions** : ce que Zylot remarque seul (projet endormi, travail pas sur GitHub, en-têtes à ajouter) et les propositions des audits Claude.
- **Notifications** sur le Mac ; sur le téléphone avec [ntfy](https://ntfy.sh) si un sujet est mis dans `config.local.json`.

## Installer

```bash
cp config.local.example.json config.local.json   # facultatif : port, modèle, sujet ntfy
./installer/installer.sh                         # serveur toujours allumé (surveillance comprise) + audit le lundi à 1 h
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
