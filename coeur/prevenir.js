// Prévenir : notification sur le Mac, et sur le téléphone si un sujet ntfy est configuré.
const { execFile } = require('child_process');
const { config } = require('./stockage');

function prevenir(titre, message, urgent = false) {
  const echapper = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  execFile('osascript', ['-e', `display notification "${echapper(message)}" with title "Zylot" subtitle "${echapper(titre)}"`], () => {});

  const sujet = config().ntfy;
  if (!sujet) return Promise.resolve();
  return fetch('https://ntfy.sh/' + encodeURIComponent(sujet), {
    method: 'POST',
    // Les en-têtes HTTP n'acceptent pas les accents tels quels : encodage RFC 2047, que ntfy comprend.
    headers: { Title: '=?UTF-8?B?' + Buffer.from(titre).toString('base64') + '?=', Priority: urgent ? '5' : '3' },
    body: message,
  }).catch(() => {});
}

module.exports = { prevenir };
