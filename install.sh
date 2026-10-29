#!/bin/sh
# Compatibility entry point. Implementation lives only in scripts/install.sh.
set -eu
if [ -f "$(dirname "$0")/scripts/install.sh" ]; then
  exec sh "$(dirname "$0")/scripts/install.sh" "$@"
fi
installer=$(mktemp)
trap 'rm -f "$installer"' EXIT HUP INT TERM
curl -fsSL https://raw.githubusercontent.com/Freecode100Year/htmlroom/main/scripts/install.sh -o "$installer"
sh "$installer" "$@"
