// L'état des dépôts git, lu sur le disque (sans rien modifier).
const { execFile } = require('child_process');

function git(dossier, args) {
  return new Promise(resolve => {
    execFile('git', ['--no-optional-locks', '-C', dossier, ...args], { timeout: 10000 }, (e, out) => resolve(e ? null : out.trim()));
  });
}

async function etat(p) {
  const [log, statut, branche, enAvance, remote] = await Promise.all([
    git(p.dossier, ['log', '-1', '--format=%cI%x1f%s']),
    git(p.dossier, ['status', '--porcelain']),
    git(p.dossier, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(p.dossier, ['rev-list', '--count', '@{u}..HEAD']),
    git(p.dossier, ['remote', 'get-url', 'origin']),
  ]);
  if (log === null && statut === null) return { git: false };
  const [quand, message] = log ? log.split('\x1f') : [null, null];
  const m = remote && remote.match(/github\.com[:/](.+?)(\.git)?$/);
  return {
    git: true,
    dernierCommit: quand ? { quand, message } : null,
    nonCommites: statut ? statut.split('\n').filter(Boolean).length : 0,
    nonPousses: enAvance === null ? null : Number(enAvance),
    branche,
    github: m ? 'https://github.com/' + m[1] : null,
  };
}

async function tous(projets) {
  const r = {};
  await Promise.all(projets.map(async p => { r[p.id] = await etat(p); }));
  return r;
}

module.exports = { tous };
