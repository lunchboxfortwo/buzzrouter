#!/usr/bin/env bash
# Keep BuzzRouter's OWN community joinable from the directory.
#
# Why this exists: relay.buzzrouter.com was listed with no display name and no
# invite code, so the directory's flagship community had no join button. Minting
# an invite needs an owner/admin NIP-98 signature, and our bridge key is not a
# member of that relay — but we OPERATE the relay, so this mints a DISPOSABLE
# admin, uses it once, removes it, and discards the key. No long-lived secret is
# stored anywhere.
#
# It runs on a timer (buzzrouter-home-invite.timer): the relay ceiling is 30
# days (MAX_INVITE_TTL_SECS in buzz-core/src/invite.rs), and a lapsed code means
# our own community silently loses its join button.
#
# Calls docker directly, NOT via sudo: the service runs as lunchbox (already in
# the docker group) under NoNewPrivileges=yes, which blocks sudo outright. The
# neighbouring discovery units do the same.
#
# Every node snippet runs INSIDE the web container. The host checkout has no
# node_modules (deps live in the image), so running node on the host works from
# a dev shell and fails under systemd with MODULE_NOT_FOUND.
#
# Usage:  scripts/refresh-home-invite.sh          # mint + store
#         scripts/refresh-home-invite.sh --check  # report current expiry only
set -euo pipefail

HOST="${BUZZROUTER_HOME_HOST:-relay.buzzrouter.com}"
RELAY_CONTAINER="${BUZZROUTER_RELAY_CONTAINER:-buzz-router-prod-relay-1}"
DB_CONTAINER="${BUZZROUTER_DB_CONTAINER:-buzzrouter-postgres-1}"
APP_CONTAINER="${BUZZROUTER_APP_CONTAINER:-buzzrouter-web-1}"

psql_q() { docker exec "$DB_CONTAINER" psql -U buzzrouter -d buzzrouter -tAc "$1"; }

stored_code() {
  psql_q "SELECT cs.source_invite_code FROM community_sources cs
          JOIN community_candidates cc ON cc.id = cs.candidate_id
          WHERE cc.host = '${HOST}';" | tr -d ' '
}

check_expiry() {
  docker exec -i -e CODE="$1" "$APP_CONTAINER" node - <<'JS'
const code = process.env.CODE || "";

// Keep these shape branches in sync with src/directory/invite-code-format.ts.
// Versioned codes are opaque: only the relay's live probe can judge them.
if (/^v\d+[.][A-Za-z0-9._~-]{8,}$/.test(code)) {
  console.log(
    "invite expiry/validity is governed by the live joinability probe, not embedded in the code",
  );
  process.exit(0);
}

const raw = code.split(".")[0];
const json = Buffer.from(raw + "=".repeat((4 - (raw.length % 4)) % 4), "base64url");
const days = (JSON.parse(json).e - Math.floor(Date.now() / 1000)) / 86400;
console.log(days > 0
  ? `invite valid for ${days.toFixed(1)} more days`
  : `invite EXPIRED ${(-days).toFixed(1)} days ago`);
process.exit(days > 0.5 ? 0 : 1);
JS
}

if [[ "${1:-}" == "--check" ]]; then
  code="$(stored_code)"
  [[ -z "$code" ]] && { echo "no invite code stored for ${HOST}" >&2; exit 1; }
  check_expiry "$code"
  exit $?
fi

# 1. Disposable admin. Its only power is minting invites on our own relay, and
#    it is removed below, so nothing holds it long-term.
keypair="$(docker exec -i "$APP_CONTAINER" node - <<'JS'
const { generateSecretKey, getPublicKey } = require("nostr-tools/pure");
const sk = generateSecretKey();
process.stdout.write(Buffer.from(sk).toString("hex") + " " + getPublicKey(sk));
JS
)"
sk="${keypair%% *}"
pub="${keypair##* }"
unset keypair
docker exec "$RELAY_CONTAINER" buzz-admin add-member --pubkey "$pub" --role admin >/dev/null
echo "minted disposable admin ${pub:0:12}…"

# 2. Mint. MintInviteRequest takes ttl_secs (NOT expires_in_days, which serde
#    drops silently, falling back to the 72h default). Ceiling is 30 days;
#    max_uses ceiling is 10_000 (buzz-core/src/invite.rs).
code="$(docker exec -i -e SK="$sk" -e RELAY_HOST="$HOST" "$APP_CONTAINER" node - <<'JS'
const { createHash, randomUUID } = require("crypto");
const { finalizeEvent } = require("nostr-tools/pure");
const sk = Buffer.from(process.env.SK, "hex");
const url = `https://${process.env.RELAY_HOST}/api/invites`;
const body = JSON.stringify({ ttl_secs: 30 * 24 * 60 * 60, max_uses: 10000 });
const ev = finalizeEvent({
  kind: 27235, created_at: Math.floor(Date.now() / 1000), content: "",
  tags: [["u", url], ["method", "POST"], ["nonce", randomUUID()],
         ["payload", createHash("sha256").update(body).digest("hex")]],
}, sk);
fetch(url, { method: "POST", body,
  headers: { "Content-Type": "application/json",
             Authorization: "Nostr " + Buffer.from(JSON.stringify(ev)).toString("base64") } })
  .then((r) => r.json())
  .then((j) => {
    if (!j.code) throw new Error("mint failed: " + JSON.stringify(j).slice(0, 200));
    process.stdout.write(j.code);
  })
  .catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });
JS
)"
unset sk

# 3. Remove the disposable admin so it cannot mint again.
docker exec "$RELAY_CONTAINER" buzz-admin remove-member --pubkey "$pub" >/dev/null 2>&1 || true

# 4. Store. The code is base64url + '.' only; refuse anything else rather than
#    interpolating a surprise into SQL.
[[ "$code" =~ ^[A-Za-z0-9_.=-]+$ ]] || { echo "refusing to store an odd-looking code" >&2; exit 1; }
psql_q "UPDATE community_sources cs
        SET source_invite_code = '${code}'
        FROM community_candidates cc
        WHERE cc.id = cs.candidate_id AND cc.host = '${HOST}';" >/dev/null
echo "stored a fresh invite for ${HOST}"
check_expiry "$code"
