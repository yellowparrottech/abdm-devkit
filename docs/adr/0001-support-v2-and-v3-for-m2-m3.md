# 1. Support both V2 and V3 APIs for M2 and M3

Date: 2026-10-27
Status: Accepted

## Context

ABDM's current APIs are V3. Replies from ABDM staff on the developer forum say V3 is ready for M1 (ABHA), but that V3 for M2 (HIP linking and data transfer) and M3 (HIU consent and data fetch) "are yet not stable", and recommend V2 for those milestones. The replies are undated in what we could see, and integrators already in production may be on either version.

## Decision

- M1 uses V3 only.
- M2 and M3 support both V2 and V3, chosen per flow by a version policy in `@yellowparrottech/abdm-client`. The default is V3; operators can switch any M2/M3 flow to V2 in config.
- The core, consent engine and MCP tools never see the version. Each version has its own wire adapter that maps ABDM requests and callbacks to the same domain events.
- The mock gateway and contract tests cover both versions for every M2/M3 flow.

## Consequences

- Two wire adapters per M2/M3 flow, and twice the contract tests for those flows.
- Integrators can follow whichever version NHA's sandbox and certification currently expect, without code changes.
- We remove V2 once NHA declares V3 stable for M2/M3 and our nightly V3 sandbox runs have passed for 30 days, announcing the removal one minor release ahead.

## Open questions (Phase 0)

- Confirm which endpoints "V2" refers to for the gateway (HIE-CM) flows, and whether they differ from the older v0.5 paths.
- Confirm which version the current functional-testing agencies test M2/M3 against.
