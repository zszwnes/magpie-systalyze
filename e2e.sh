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
# SYSTALYZE_CONSEC is the optional console session cookie
# (__Secure-better-auth.session_token from console.systalyze.com): with it the
# usage windows are the vendor's own balance and billing, without it they are
# magpie's estimate. Leave it empty to exercise the estimate path.
# MAGPIE is the magpie binary (default: magpie on PATH, else the Windows build).
set -eu
: "${SYSTALYZE_KEY:?}"
name=${SYSTALYZE_NAME-}
cookie=${SYSTALYZE_CONSEC-}
here=$(cd "$(dirname "$0")" && pwd)
sb=$here/.e2e/$(printf %s "$SYSTALYZE_KEY" | (md5sum 2>/dev/null || shasum) | cut -c1-8)
rm -rf "$sb" && mkdir -p "$sb"
m=${MAGPIE:-$(command -v magpie || echo "/d/工具/magpie-windows-amd64.exe")}
# USERPROFILE/APPDATA are what the Windows build treats as HOME.
# The sandbox starts with no Bun, and magpie would download one: reuse the one
# this machine already has, or set MAGPIE_BUN to a bun of your own.
real_home=${HOME-}
if [ -z "${MAGPIE_BUN-}" ]; then
  for b in "$real_home/.cache/magpie/bun"/*/magpie-bun.exe "$real_home"/.bun/bin/bun "$(command -v bun 2>/dev/null)"; do
    [ -x "$b" ] && { MAGPIE_BUN=$b; break; }
  done
fi
# unquoted on purpose: it is empty when there is no Bun to point at
bunenv=""
[ -n "${MAGPIE_BUN-}" ] && bunenv="MAGPIE_BUN=$MAGPIE_BUN"
run() { env -i PATH="$PATH" HOME="$sb" USERPROFILE="$sb" APPDATA="$sb/.config" \
  XDG_CONFIG_HOME="$sb/.config" XDG_CACHE_HOME="$sb/.cache" MAGPIE_PLUGIN_MARKET=off \
  $bunenv "$m" "$@"; }

echo "== $("$m" --version 2>/dev/null || echo magpie: "$m")"
echo "== plugin add"; run plugin add "$here" </dev/null
# options are addressed by the plugin's name: the package's name when magpie
# installed it from npm or GitHub, the folder's when it was added by path.
# PLUGIN_NAME overrides both.
echo "== plugin options"
run plugin options ${PLUGIN_NAME:-$(basename "$here")} '{"localUsage":true,"budgetDaily":0}' </dev/null
# the sign-in asks for the account's name, then for an optional console cookie,
# then for the key
echo "== plugin login systalyze"
printf '%s\n%s\n%s\n' "$name" "$cookie" "$SYSTALYZE_KEY" | run plugin login systalyze
# magpie's ledger is the only usage source this plugin has, so a fresh sandbox
# starts at zero: SEED=1 puts a few synthetic rows in it to see the windows move
[ -n "${SEED-}" ] && node "$here/test/seed-usage.mjs" "$sb"
echo "== quota systalyze --json"; run quota systalyze --json </dev/null
echo "== plugin list"; run plugin list </dev/null
echo "== models"; run models </dev/null | grep -i systalyze || true
echo "== provider test systalyze"; run provider test systalyze </dev/null
