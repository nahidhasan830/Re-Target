#!/bin/zsh
set -e
cd -- "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

finish() {
  local result=$?
  if [[ -t 0 ]]; then
    if (( result != 0 )); then print "Deployment stopped. See the error above."; fi
    read -r "?Press Return to close this window."
  fi
  return $result
}
trap finish EXIT

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh"
  nvm use
fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  print "Install Node.js 24, then open Deploy.command again."
  exit 1
fi
node --input-type=module -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Use Node.js 24 or newer."); process.exit(1); }'
npm ci
npm run deploy
open 'https://retarget.nahidlabs.com'
