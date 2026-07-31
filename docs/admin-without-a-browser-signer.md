# Administering a community without a browser signer

The shared-channel and claim pages sign every request with NIP-98, which
normally means a NIP-07 browser extension (Alby, nos2x). If you do not want
one — or you are working on a server — `npm run admin` signs exactly the same
requests with a local key.

The key never leaves your machine. Only the signed kind-27235 event is sent,
which is the same thing an extension would send.

```bash
export BUZZROUTER_ADMIN_KEY=nsec1...          # or a 64-character hex key
export BUZZROUTER_ADMIN_ORIGIN=https://buzzrouter.com   # optional, this is the default

npm run admin -- <METHOD> <path> ['<json body>']
```

## Claiming a community

```bash
# 1. Start a challenge. Methods: dns_txt, http_file, hosted_icon.
npm run admin -- POST /api/claims/challenges \
  '{"candidateId":"<uuid>","method":"dns_txt"}'

# 2. Publish the proof it returns. For dns_txt that is a TXT record at
#    _buzzrouter.<host> containing buzzrouter-claim=<token>.

# 3. Verify.
npm run admin -- POST /api/claims/challenges/<challengeId>/verify '{}'

# 4. Publish the listing.
npm run admin -- PUT /api/communities/<candidateId> \
  '{"displayName":"...","description":"...","slug":"...","categories":[],
    "joinMode":"request_invite","joinUrl":null,
    "openToSharedChannels":true,"visibility":"public"}'
```

The candidate id is visible in the claim page URL for your community.

## Connecting the relay and sharing a channel

```bash
# Mint the one-time installer token; the response includes the exact command.
npm run admin -- POST /api/community-connections/install-token \
  '{"communityId":"<uuid>","idempotencyKey":"install-1"}'

# Run the printed npx command on the community's own host. If buzz-admin is
# not on PATH there, point the installer at it:
export BUZZROUTER_ADMIN_COMMAND='["docker","compose","exec","-T","relay","/usr/local/bin/buzz-admin"]'

# Inspect the workspace, then propose, accept, pause, resume, or disconnect.
npm run admin -- GET  /api/shared-channels
npm run admin -- POST /api/shared-channels \
  '{"sourceCommunityId":"<uuid>","destinationCommunityId":"<uuid>",
    "proposedName":"benchmark-review","purpose":"...",
    "sourceChannelId":"<channel>","sourceChannelName":"...",
    "idempotencyKey":"propose-1"}'
npm run admin -- POST /api/shared-channels/<id>/accept '{"localChannelId":"<channel>","localChannelName":"...","idempotencyKey":"accept-1"}'
npm run admin -- POST /api/shared-channels/<id>/pause '{"idempotencyKey":"pause-1"}'
```

Community ids differ from candidate ids. `GET /api/shared-channels` returns
the community ids your key owns.

## Notes

- Requests are owner-only. The key must be the `owner_pubkey` recorded when
  the community was claimed.
- Signatures are valid for a short window and each nonce is single-use, so
  scripts should sign per request rather than reuse an authorization header.
- A non-2xx response exits non-zero and prints the API error body.
