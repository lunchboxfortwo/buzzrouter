#!/usr/bin/env bash
# Keep BuzzRouter's OWN community joinable from the directory.
#
# Why this exists: relay.buzzrouter.com was listed with no display name and no
# invite code, so the directory's flagship community had no join button. Minting
# an invite needs an owner/admin NIP-98 signature, and our bridge key is not a
# member of that relay — but we OPERATE the relay, so we can mint an admin,
# use it once, and throw it away. No long-lived secret is stored anywhere.
#
# It still has to run on a schedule: the relay ceiling is 30 days
# (MAX_INVITE_TTL_SECS in buzz-core/src/invite.rs), so a code always ages out
# eventually and a stale code is a dead join button. Run this well inside 30d.
#
# Usage:  scripts/refresh-home-invite.sh          # mint + store
#         scripts/refresh-home-invite.sh --check  # report current expiry only
set -euo pipefail

HOST="${BUZZROUTER_HOME_HOST:-relay.buzzrouter.com}"
RELAY_CONTAINER="${BUZZROUTER_RELAY_CONTAINER:-buzz-router-prod-relay-1}"
DB_CONTAINER="${BUZZROUTER_DB_CONTAINER:-buzzrouter-postgres-1}"

psql_q() { sudo -n docker exec "$DB_CONTAINER" psql -U buzzrouter -d buzzrouter -tAc "$1"; }

if [[ "${1:-}" == "--check" ]]; then
  code=$(psql_q "SELECT cs.source_invite_code FROM community_sources cs
                 JOIN community_candidates cc ON cc.id=cs.candidate_id
                 WHERE cc.host='${HOST}';" | tr -d ' ')
  [[ -z "$code" ]] && { echo "no invite code stored for ${HOST}"; exit 1; }
  node -e '
    const c=process.argv[1].split(".")[0];
    const p=JSON.parse(Buffer.from(c + "=".repeat((4-c.length%4)%4),"base64url"));
    const days=(p.e-Math.floor(Date.now()/1000))/86400;
    console.log(days>0 ? `invite valid for ${days.toFixed(1)} more days`
                       : `invite EXPIRED ${(-days).toFixed(1)} days ago`);
    process.exit(days>0.5?0:1);
  ' "$code"
  exit $?
fi

work=$(mktemp -d); trap 'shred -u "$work"/* 2>/dev/null; rmdir "$work" 2>/dev/null' EXIT

# 1. Disposable admin. Its only power is minting invites on our own relay, and
#    it is shredded below, so nothing needs to hold it long-term.
node -e '
  const {generateSecretKey,getPublicKey}=require("nostr-tools/pure");
  const fs=require("fs");
  const sk=generateSecretKey();
  fs.writeFileSync(process.argv[1]+"/sk", Buffer.from(sk).toString("hex"), {mode:0o600});
  fs.writeFileSync(process.argv[1]+"/pub", getPublicKey(sk));
' "$work"
pub=$(cat "$work/pub")
sudo -n docker exec "$RELAY_CONTAINER" buzz-admin add-member --pubkey "$pub" --role admin >/dev/null
echo "minted disposable admin ${pub:0:12}…"

# 2. Mint the invite with it.
code=$(node -e '
  const {readFileSync}=require("fs");
  const {createHash,randomUUID}=require("crypto");
  const {finalizeEvent}=require("nostr-tools/pure");
  const sk=Buffer.from(readFileSync(process.argv[1]+"/sk","utf8").trim(),"hex");
  const url=`https://${process.argv[2]}/api/invites`;
  // MintInviteRequest takes ttl_secs (NOT expires_in_days, which serde drops
  // silently, falling back to the 72h default). Ceiling is 30 days,
  // max_uses ceiling is 10_000 (buzz-core/src/invite.rs).
  const body=JSON.stringify({ttl_secs: 30*24*60*60, max_uses: 10000});
  const ev=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:"",
    tags:[["u",url],["method","POST"],["nonce",randomUUID()],
          ["payload",createHash("sha256").update(body).digest("hex")]]},sk);
  fetch(url,{method:"POST",headers:{"Content-Type":"application/json",
    Authorization:"Nostr "+Buffer.from(JSON.stringify(ev)).toString("base64")},body})
    .then(r=>r.json()).then(j=>{ if(!j.code) throw new Error("mint failed: "+JSON.stringify(j).slice(0,200));
      process.stdout.write(j.code); });
' "$work" "$HOST")

# 3. Remove the disposable admin so it cannot mint again once shredded.
sudo -n docker exec "$RELAY_CONTAINER" buzz-admin remove-member --pubkey "$pub" >/dev/null 2>&1 || true

# 4. Store it. Single-quote-safe: the code is base64url + '.' only.
[[ "$code" =~ ^[A-Za-z0-9_.=-]+$ ]] || { echo "refusing to store an odd-looking code" >&2; exit 1; }
psql_q "UPDATE community_sources cs
        SET source_invite_code='${code}'
        FROM community_candidates cc
        WHERE cc.id=cs.candidate_id AND cc.host='${HOST}';" >/dev/null
echo "stored a fresh invite for ${HOST}"
"$0" --check
