#!/usr/bin/env node
// Audit de nuit : tous les projets, l'un après l'autre.
//   node nuit.js            → tous les projets
//   node nuit.js lmo plan2  → seulement ceux-là
const S = require('./coeur/stockage');
const { auditer } = require('./coeur/audit');
const { prevenir } = require('./coeur/prevenir');

async function principal() {
  if (S.verrou()) { console.log('Un audit tourne déjà.'); return; }
  const demandes = process.argv.slice(2);
  const liste = S.projets().filter(p => !demandes.length || demandes.includes(p.id));
  if (!liste.length) { console.log('Aucun projet ne correspond.'); return; }

  const { modele } = S.config();
  const bilan = { urgent: 0, securite: 0, info: 0, erreurs: 0, faits: 0 };
  S.journal('Tous', `Audit lancé sur ${liste.length} projet${liste.length > 1 ? 's' : ''}`);

  for (const [i, p] of liste.entries()) {
    S.poserVerrou({ projet: p.id, debut: new Date().toISOString(), rang: i + 1, total: liste.length });
    console.log(`[${i + 1}/${liste.length}] ${p.nom}…`);
    const r = require('fs').existsSync(p.dossier)
      ? await auditer(p, { modele })
      : { ok: false, erreur: 'Dossier introuvable : ' + p.dossier };

    if (!r.ok) {
      bilan.erreurs++;
      S.journal(p.nom, (r.quota ? 'quota atteint : ' : 'audit en échec : ') + r.erreur.slice(0, 200), 'erreur');
      S.enregistrerRapport(p.id, { quand: new Date().toISOString(), erreur: r.erreur, duree: r.duree });
      if (r.quota) {
        S.ajouterAlertes(p.id, [{ gravite: 'info', titre: 'Quota Claude atteint, audit interrompu',
          detail: `L'audit s'est arrêté sur ${p.nom}. Les projets suivants n'ont pas été vus : ${liste.slice(i + 1).map(x => x.nom).join(', ') || 'aucun'}.` }]);
        await prevenir('Quota atteint', `Audit interrompu sur ${p.nom}.`);
        break;
      }
      continue;
    }

    bilan.faits++;
    const rapport = { quand: new Date().toISOString(), duree: r.duree, modele, ...r.rapport };
    S.enregistrerRapport(p.id, rapport);
    const alertes = rapport.alertes || [];
    for (const a of alertes) bilan[a.gravite] = (bilan[a.gravite] || 0) + 1;
    const nouvelles = S.ajouterAlertes(p.id, alertes);
    S.journal(p.nom, `audit terminé en ${Math.round(r.duree / 60)} min · ${alertes.length} point${alertes.length > 1 ? 's' : ''}` +
      (nouvelles < alertes.length ? ` dont ${alertes.length - nouvelles} déjà connu${alertes.length - nouvelles > 1 ? 's' : ''}` : ''),
      rapport.etat === 'urgent' ? 'urgent' : 'info');
    if (alertes.some(a => a.gravite === 'urgent')) {
      await prevenir(`Urgent : ${p.nom}`, alertes.find(a => a.gravite === 'urgent').titre, true);
    }
  }

  S.leverVerrou();
  const resume = `${bilan.faits}/${liste.length} projets vus · ${bilan.urgent} urgent · ${bilan.securite} sécurité · ${bilan.info} info` +
    (bilan.erreurs ? ` · ${bilan.erreurs} en échec` : '');
  S.journal('Tous', 'Audit fini : ' + resume);
  await prevenir('Audit terminé', resume, bilan.urgent > 0);
  console.log(resume);
}

principal().catch(e => { S.leverVerrou(); S.journal('Tous', 'Audit planté : ' + e.message, 'erreur'); console.error(e); process.exit(1); });
