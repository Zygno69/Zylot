// Protections anti-robots, vérifiées chaque jour sans Claude et sans rien envoyer.
//
// Deux sortes de vérifications, décrites projet par projet dans projets.json (champ « antirobot ») :
// - « formulaires » : la page publique est lue en ligne, et on vérifie que le formulaire porte bien
//   son champ piège (invisible pour les humains) et, s'il en a un, son contrôle de délai.
//   Aucun envoi : on ne fait que lire la page.
// - « gardes » : le code du dernier commit (celui que la CI met en ligne) doit toujours contenir les
//   protections ajoutées (limites d'essais, liens sur l'adresse fixe…). Si une modification les retire,
//   Zylot le voit au contrôle suivant. On ne teste jamais les limites en ligne : ce serait bloquer
//   sa propre connexion.
const { execFile } = require('child_process');
const path = require('path');
const S = require('./stockage');

const configuration = () => S.lire(path.join(S.RACINE, 'antirobot.json'), {});

function lireAuCommit(dossier, fichier) {
  return new Promise(res => execFile('git', ['-C', dossier, 'show', 'HEAD:' + fichier], { timeout: 8000, maxBuffer: 20e6 },
    (e, out) => res(e ? null : out)));
}

// Le formulaire qui contient ce champ (ou le premier formulaire POST de la page).
function formulaires(html) {
  return [...html.matchAll(/<form\b[^>]*method=["']?post["']?[^>]*>([\s\S]*?)<\/form>/gi)].map(m => m[1]);
}
const aChamp = (html, nom) => new RegExp(`<input\\b[^>]*name=["']${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i').test(html);

async function controler(p, base, obtenir) {
  const conf = configuration()[p.id];
  if (!conf) return null;
  const verifs = [];
  const ajout = (ok, titre, detail, extra = {}) => verifs.push({ ok, titre, detail, ...extra });

  for (const f of conf.formulaires || []) {
    let r = await obtenir(base + f.url, { taille: 3e6 });
    let html = r.code === 200 ? r.corps || '' : '';
    // Page qui liste plusieurs formulaires (ex. stages) : on suit le premier lien indiqué.
    if (html && f.suivre && !formulaires(html).length) {
      const m = html.match(new RegExp(f.suivre));
      if (m) { r = await obtenir(new URL(m[0], base + f.url).href, { taille: 3e6 }); html = r.code === 200 ? r.corps || '' : ''; }
    }
    if (!html) { ajout(true, f.quoi, `Page ${f.url} injoignable pendant le contrôle (code ${r.code || r.erreur || '?'}) : non vérifié cette fois.`, { nonVerifie: true }); continue; }
    const forms = formulaires(html);
    if (!forms.length) { ajout(true, f.quoi, `Pas de formulaire sur ${f.url} en ce moment${f.absentNormal ? ' (' + f.absentNormal + ')' : ''} : rien à vérifier.`, { nonVerifie: true }); continue; }
    const form = forms.find(x => aChamp(x, f.piege)) || forms[0];
    const manque = [];
    if (f.piege && !aChamp(form, f.piege)) manque.push('le champ piège');
    if (f.delai && !aChamp(form, f.delai)) manque.push('le contrôle de délai');
    ajout(!manque.length, f.quoi, manque.length ? `${f.url} : ${manque.join(' et ')} a disparu du formulaire. Les robots peuvent de nouveau l'envoyer en masse.` : `${f.url} : champ piège${f.delai ? ' et contrôle de délai' : ''} en place.`);
  }

  for (const g of conf.gardes || []) {
    const code = await lireAuCommit(p.dossier.replace(/^~/, process.env.HOME), g.fichier);
    if (code === null) { ajout(false, g.quoi, `Fichier ${g.fichier} introuvable dans le dernier commit : la protection a peut-être été déplacée ou supprimée.`); continue; }
    const manquants = (g.contient || []).filter(m => !code.includes(m));
    const revenus = (g.absent || []).filter(m => code.includes(m));
    ajout(!manquants.length && !revenus.length, g.quoi,
      manquants.length || revenus.length
        ? `${g.fichier} : ${manquants.length ? 'protection retirée (' + manquants.map(m => '« ' + m.slice(0, 50) + ' »').join(', ') + ')' : ''}${manquants.length && revenus.length ? ' ; ' : ''}${revenus.length ? 'ancien code revenu (' + revenus.map(m => '« ' + m.slice(0, 50) + ' »').join(', ') + ')' : ''}.`
        : `${g.fichier} : en place.`);
  }

  const echecs = verifs.filter(v => !v.ok);
  return {
    verifs,
    points: echecs.map(v => ({ gravite: 'securite', titre: `Protection anti-robots absente : ${v.titre}`, detail: v.detail, retrait: 10 })),
  };
}

module.exports = { controler };
