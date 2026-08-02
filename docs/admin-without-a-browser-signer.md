# Administering Link without a browser signer

The primary Link flow needs no browser signer: paste an owner/admin invite at
`/shared-channels`. Existing hosted communities with a recorded Nostr admin key
can also use `npm run admin` for the signed route-management API.

The key never leaves your machine. Only the signed kind-27235 event is sent,
which is the same thing an extension would send.

```bash
export BUZZROUTER_ADMIN_KEY=nsec1...          # or a 64-character hex key
export BUZZROUTER_ADMIN_ORIGIN=https://buzzrouter.com   # optional, this is the default

npm run admin -- <METHOD> <path> ['<json body>']
```

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

- Signed requests are available only when the community already has that
  `owner_pubkey` recorded.
- For every other verified community, use the invite-first web flow. The
  roster-signed confirmation message remains the authority that activates a
  channel binding.
- Signatures are valid for a short window and each nonce is single-use, so
  scripts should sign per request rather than reuse an authorization header.
- A non-2xx response exits non-zero and prints the API error body.
