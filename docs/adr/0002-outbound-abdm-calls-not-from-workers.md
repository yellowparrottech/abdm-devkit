# 2. Make outbound ABDM calls from networks ABDM accepts, not from Cloudflare Workers

Date: 2026-10-27
Status: Accepted

## Context

ABDM restricts which networks may call its sandbox hosts. On 2026-10-27 we deployed a temporary Cloudflare Worker that called `dev.abdm.gov.in` (gateway), `abhasbx.abdm.gov.in` (ABHA) and `sandbox.abdm.gov.in`. Twice, all three answered 403 within about 15 ms with an AWS CloudFront page: "The request could not be satisfied. Request blocked." Workers run near the caller and Cloudflare does not let us pin their outbound location, so outbound calls from Workers cannot be relied on.

The same day, a small cloud VM on a network ABDM accepts reached all three hosts at the application level: the gateway and ABHA hosts answered 401 (ABDM's own "Missing Credentials" error), and the sandbox portal answered with a normal redirect. An ordinary cloud server on an accepted network works.

## Decision

- The callback bridge can run on any host or cloud, including Cloudflare Workers. It only receives calls from ABDM; it never calls ABDM.
- Outbound calls to ABDM (sessions, consent requests, data requests) come from the core running on a network ABDM accepts: a developer's machine or HMIS server, or a cloud server in an accepted region.

## Consequences

- No outbound ABDM client code targets the Workers runtime.
- The sandbox guide tells developers to check that their network is accepted by ABDM.
- Sandbox development and testing run from a small cloud VM on an accepted network, reached over SSH through its provider's identity-aware tunnel only.
