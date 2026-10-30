# Zylot — mémo de reprise

Outil personnel : piloter Claude Code sur tous les projets depuis une seule interface locale. Lire `README.md` d'abord.

## Décisions prises (ne pas les remettre en question)

- **Claude Code sur abonnement, pas l'API** (jugée trop chère). Les agents sont des `claude -p` lancés par `coeur/audit.js`. Le quota est la ressource rare : un seul agent à la fois, détection de la limite, arrêt propre.
- **Tout en local** sur le Mac puis le Mac Mini. Serveur lié à 127.0.0.1 ; requêtes POST exigent l'en-tête `X-Zylot: 1` et un `Host` localhost. Accès téléphone plus tard via Tailscale, pas d'hébergement public.
- **Paliers** : 1) audit en lecture seule, **chaque semaine** (lundi 1 h) pour ménager le quota (fait) ; 2) écriture de code jusqu'à la PR ; 3) mise en prod sur feu vert, deux clics. Tout ce qui touche à la base, aux factures, aux données personnelles ou à l'authentification reste soumis à validation.
- Node sans dépendance. Pas de framework.
- Surveillance, contrôles de sécurité et état des dépôts tournent **sans Claude** dans `serveur.js` (coeur/surveillance.js, securite.js, depots.js) : zéro quota. Claude ne sert qu'à lire le code et proposer.
- Adresse : http://zylot.localhost:4000 (le port 80 demande les droits administrateur sur macOS).
- Dans l'interface, la ligue s'appelle « Ligue hockey » (le sigle est proscrit sur ce projet).

- Conversations (`coeur/conversation.js`) : un seul mode, Claude écrit librement dans son worktree (`donnees/ateliers/<projet>`, node_modules/vendor en lien symbolique), session reprise avec `--resume`, texte mot à mot (`--include-partial-messages`). Il agit sur le vrai projet via `outils/zylot` (jeton par tour de conversation) : `garder "message"` = commit + `merge --ff-only` ; `deployer` = commande `deploy` de projets.json, refusée si le dernier message du propriétaire ne demande pas la mise en prod (regex DEMANDE_PROD). Sous-agents, push, commit direct et rm interdits.

## Pièges connus

- L'agent hérite de l'environnement : `audit.js` retire toutes les variables `CLAUDE*` / `ANTHROPIC*`, sinon une session de l'appli de bureau lui passe sa propre connexion.
- La commande `claude` a sa propre connexion, distincte de l'appli : si les audits échouent en « 401 OAuth access token is invalid », il faut `claude` puis `/login` dans un terminal.
- `donnees/` ne va jamais dans git.
