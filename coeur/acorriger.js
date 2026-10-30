// Points à corriger d'un projet, posés par Zylot ou par le développeur : ils restent affichés dans la conversation
// jusqu'à ce qu'on les marque faits ou ignorés, et Claude les reçoit dans son contexte.
const path = require('path');
const crypto = require('crypto');
const S = require('./stockage');

const fichier = id => path.join(S.DONNEES, 'a-corriger-' + id + '.json');
const lire = id => S.lire(fichier(id), []);

function ouverts(id) { return lire(id).filter(x => !x.clos); }

function ajouter(id, points) {
  const l = lire(id);
  for (const p of points) {
    if (l.some(x => !x.clos && x.titre === p.titre)) continue;
    l.push({ id: crypto.randomBytes(4).toString('hex'), quand: new Date().toISOString(), gravite: p.gravite || 'securite', titre: p.titre, detail: p.detail, vous: p.vous || null });
  }
  S.ecrire(fichier(id), l);
}

function clore(id, pointId, comment) {
  const l = lire(id);
  const x = l.find(p => p.id === pointId);
  if (!x) return null;
  x.clos = new Date().toISOString(); x.comment = comment;
  S.ecrire(fichier(id), l);
  return x;
}

module.exports = { ouverts, ajouter, clore };
