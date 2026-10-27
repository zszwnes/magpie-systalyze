#!/bin/sh
# Manual check, before each release: this checkout in a REAL magpie, in a
# sandbox of its own (.e2e/), so your magpie's config, agents and sign-ins are
# never touched:
#   SYSTALYZE_KEY=stlzi_... ./e2e.sh
# It adds this plugin, signs in with the key, and prints what magpie then
# shows: the plugin list, the provider's models, the key's usage (magpie
# quota) and magpie provider test (one tiny real request).
#
# The vendor has no quota endpoint at all (see README), so the usage windows
# are summed from magpie's own ledger: a fresh sandbox starts out at zero.
# Route a few requests through this provider first if you want to see numbers.
# SYSTALYZE_NAME names the account (default: none, so it shows as key …last4).
# MAGPIE is the magpie binary (default: magpie on PATH, else the Windows build).
set -eu
: "${SYSTALYZE_KEY:?}"
name=${SYSTALYZE_NAME-}
here=$(cd "$(dirname "$0")" && pwd)
sb=$here/.e2e/$(printf %s "$SYSTALYZE_KEY" | (md5sum 2>/dev/null || shasum) | cut -c1-8)
rm -rf "$sb" && mkdir -p "$sb"
m=${MAGPIE:-$(command -v magpie || echo "/d/工具/magpie-windows-amd64.exe")}
# USERPROFILE/APPDATA are what the Windows build treats as HOME
run() { env -i PATH="$PATH" HOME="$sb" USERPROFILE="$sb" APPDATA="$sb/.config" \
  XDG_CONFIG_HOME="$sb/.config" XDG_CACHE_HOME="$sb/.cache" MAGPIE_PLUGIN_MARKET=off "$m" "$@"; }

echo "== $("$m" --version 2>/dev/null || echo magpie: "$m")"
echo "== plugin add"; run plugin add "$here" </dev/null
echo "== plugin options"
run plugin options magpie-systalyze '{"localUsage":true,"perModel":true}' </dev/null
# the sign-in asks for the account's name, then for the key
echo "== plugin login systalyze"
printf '%s\n%s\n' "$name" "$SYSTALYZE_KEY" | run plugin login systalyze
echo "== quota systalyze --json"; run quota systalyze --json </dev/null
echo "== plugin list"; run plugin list </dev/null
echo "== models"; run models </dev/null | grep -i systalyze || true
echo "== provider test systalyze"; run provider test systalyze </dev/null
