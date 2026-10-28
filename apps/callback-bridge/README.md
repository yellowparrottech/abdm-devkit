# @yellowparrottech/abdm-callback-bridge

Self-hosted receiver for ABDM gateway callbacks. It runs on your own host or cloud; a ready-made Cloudflare Workers setup with D1 is included, and other platforms need only a store implementing `CallbackStore`. ABDM sends M2/M3 results to one public HTTPS address per client ID and expects an immediate 202; its retry behaviour is not guaranteed. The bridge durably records every callback it receives, so nothing it accepted is lost (it cannot record callbacks that never reach it):

1. **Verify:** each callback must carry the gateway's RS256 bearer token, signed by a key from the gateway's published key set, unexpired, from the expected issuer and, if set, for the expected audience. Unverified callbacks get 401 and are not stored. Unknown key IDs refetch the key set at most once a minute, and the last good keys are kept if a fetch fails.
2. **Refuse replays:** the `REQUEST-ID` must be well formed and not seen in the last 24 hours (remembered even after the callback is acknowledged), and the `TIMESTAMP` must be ISO 8601 with a time zone and within 5 minutes. A repeated request ID gets 202 but is not stored again.
3. **Store, then acknowledge:** the callback is written to D1 before the 202 goes back, its body encrypted with AES-256-GCM under the `STORAGE_KEY` secret and bound to its request ID, so nothing readable is stored at rest. Bodies are capped at 1.9 MB, under D1's row limit, however the request declares its size; ABDM splits larger record pushes into pages. The gateway's token is not stored.
4. **Deliver by pull:** the core reads `GET /v1/inbox?after=<id>` and acknowledges with `POST /v1/inbox/ack` (up to 100 IDs, D1's parameter limit), using a separate inbox token. The core can run anywhere, including a laptop behind NAT. Delivery is at least once, so handlers must tolerate repeats; the DevKit's workflows do.

Because ABDM's encryption does not prove who sent a record push, verification at the bridge is what stops forged pushes. Only deliver callbacks to the core through the bridge.

## Deploy

```sh
cp wrangler.toml.example wrangler.toml   # fill in the D1 database ID and the key set URL
wrangler d1 create abdm-callbacks
wrangler d1 execute abdm-callbacks --remote --file schema.sql
wrangler secret put INBOX_TOKEN
openssl rand -base64 32 | wrangler secret put STORAGE_KEY
wrangler deploy
```

The Worker answers 503 until the key set URL, the issuer, the inbox token and the storage key are all set. Losing the storage key makes stored, uncollected callbacks unreadable; keep a copy in your password manager.

Upgrading from an earlier build: run `schema.sql` again to add the `seen_requests` table.

**To confirm in Phase 0:** the gateway key set URL, issuer and audience claims for V3 callbacks in the sandbox, and the callback paths, which are recorded as received.

Pre-release; not yet published to npm.
