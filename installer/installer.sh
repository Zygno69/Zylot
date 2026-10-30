#!/bin/zsh
# Installe Zylot dans le planificateur de macOS (launchd) :
#   - le serveur de l'interface, toujours allumé, relancé s'il tombe ;
#   - l'audit de nuit, chaque jour à 1 h.
# ./installer/installer.sh            → installe (ou réinstalle)
# ./installer/installer.sh retirer    → retire les deux
set -e
RACINE="${0:A:h:h}"
AGENTS="$HOME/Library/LaunchAgents"
NODE="$(command -v node)"
CHEMIN="$(dirname "$NODE"):$(dirname "$(command -v claude)"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$AGENTS" "$RACINE/donnees"

retirer() {
  for nom in serveur nuit; do
    launchctl bootout "gui/$UID/fr.zylot.$nom" 2>/dev/null || true
    rm -f "$AGENTS/fr.zylot.$nom.plist"
  done
}

if [[ "$1" == "retirer" ]]; then retirer; echo "Zylot retiré du planificateur."; exit 0; fi
retirer

ecrire() { # $1 nom, $2 script, $3 bloc propre à l'agent
  cat > "$AGENTS/fr.zylot.$1.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>fr.zylot.$1</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$RACINE/$2</string></array>
  <key>WorkingDirectory</key><string>$RACINE</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$CHEMIN</string></dict>
  <key>StandardOutPath</key><string>$RACINE/donnees/$1.log</string>
  <key>StandardErrorPath</key><string>$RACINE/donnees/$1.log</string>
$3
</dict></plist>
EOF
  launchctl bootstrap "gui/$UID" "$AGENTS/fr.zylot.$1.plist"
}

ecrire serveur serveur.js '  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>'
ecrire nuit nuit.js '  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>1</integer><key>Minute</key><integer>0</integer></dict>'

echo "Zylot installé :"
echo "  interface    http://localhost:4000"
echo "  audit        chaque nuit à 1 h"
echo "Pour que le Mac se réveille seul à 0 h 55 (mot de passe demandé) :"
echo "  sudo pmset repeat wakeorpoweron MTWRFSU 00:55:00"
