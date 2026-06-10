#!/usr/bin/env bash
set -euo pipefail

cd /home/farhan/listinglens
source "$HOME/.nvm/nvm.sh"
exec npm run dev -- --hostname 0.0.0.0 --port 3000
