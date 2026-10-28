# @yellowparrottech/abdm-client

Talks to ABDM's APIs. M1 (ABHA) uses V3; each M2/M3 flow can use V2 or V3 (see `docs/adr/0001`).

- `resolveVersionPolicy` validates per-flow version settings such as `{ hiuConsent: "v2" }`.
- `BridgeInbox` collects ABDM's callbacks from your callback bridge and hands them to the workflows. A callback is acknowledged, and so deleted from the bridge, only after its handler succeeds; failures stay for the next run, and callbacks no translator understands are acknowledged and reported.

The V2 and V3 request adapters and callback translators are added once their formats are confirmed in ABDM's test system. Calls to ABDM must come from a network ABDM accepts (see `docs/adr/0002`).
