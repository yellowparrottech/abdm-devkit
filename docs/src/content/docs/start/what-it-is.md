---
title: What it is and is not
description: Why the DevKit exists, the gaps it fills, who it is for, what works today, and its limits.
sidebar:
  order: 0
---

**It is** a free, open-source toolkit for building software that connects to ABDM, India's national health-record sharing system. It includes a practice version of ABDM, ready-made building blocks, a REST API and tools for AI assistants.

**It is for** developers of hospital, clinic and lab software, testing teams, and anyone building AI assistants that work with health records. If ABDM is new to you, start with [ABDM in plain words](/start/abdm-basics/).

## Why it is needed

ABDM matters: hundreds of millions of people have an ABHA health ID, and hospitals, clinics and labs are expected to share records through it. But connecting software to ABDM is hard to even begin:

- **You wait before you can write a line that works.** Test access needs an application and approval, and NHA's test examples and test cases only become available after that.
- **It answers later, by calling you.** Results arrive as messages to a public web address you must run, each expecting an instant reply. Retry behaviour is not guaranteed, so software must cope with messages that are missed, late or repeated.
- **Records need special encryption.** ABDM uses its own encryption scheme. Getting a single detail wrong means records cannot be read, and the error gives no clue why.
- **Records come in a strict format.** Health records are FHIR documents in shapes defined for India, which are detailed and easy to get subtly wrong.
- **Consent is easy to get wrong.** Patients can approve less than was asked, withdraw consent, or let it expire, and software has to respect every case.
- **AI assistants raise new risks.** Assistants that can request or read health records need firm limits on what they can do and see.

Teams often solve these one by one, in private, with tools that are hard to reuse. Most existing help explains ABDM's APIs; little of it lets you actually run a consent request and receive a record end to end.

## The gaps it fills

| Gap | What the DevKit gives you |
| --- | --- |
| Nothing works until approval arrives | A practice ABDM built in, so the whole flow runs on day one with no account |
| Replies arrive later, at a public address you must run | A callback bridge that durably records the replies it receives, refuses fakes and repeats, and keeps them until collected |
| Encryption is hard to get exactly right | Ready-made encryption checked against ABDM's published reference examples |
| Health-record formats are strict | Builders and checks for ABDM's FHIR documents |
| Consent rules are subtle | Consent checked at every step, with records deleted when consent ends |
| AI assistants need guardrails | Every request needs an approval tied to one user and one exact request, each user sees only their own work, and records are marked as untrusted data |
| Every team rebuilds the same basics | One open-source toolkit under Apache-2.0, usable from any language |

## Why we built it

YellowParrot Technologies is building an EHR that needs ABDM to share patients' records safely. We hit every one of these problems ourselves. Rather than solve them only in private, we are building the shared parts in the open, so other developers in India's digital-health community can start faster and build on tested foundations. Our EHR uses the same toolkit, under its own ABDM certification, when it goes live.

**It is not:**

- An official NHA product. It is not affiliated with, endorsed by or certified by NHA or ABDM.
- A shortcut past ABDM's rules. Using real patient data needs your own registration, testing and security audit with NHA.
- A hosted service. YellowParrot does not run it for others. The Apache-2.0 licence lets anyone run it themselves.
- A medical device. It gives no medical advice, and AI assistants can make mistakes.

## What works today

Each feature is labelled by how far it has been tested:

- **Mock-tested**: works end to end against the built-in practice ABDM, covered by automated tests.
- **Vector-tested**: matches published reference examples, not yet checked against live ABDM.
- **Partial**: some of the feature is built.
- **Experimental**: built and tested on its own, not yet tested with ABDM.
- **Not yet verified**: being built against ABDM's test system.

The tests run on every change to the code, on Node.js 22 and 24. See the [latest results](https://github.com/yellowparrottech/abdm-devkit/actions/workflows/ci.yml); the evidence column links to the tests behind each label.

| Feature | Status | Evidence |
| --- | --- | --- |
| Practice ABDM with a simulated patient and hospital | Mock-tested | [End-to-end flow](https://github.com/yellowparrottech/abdm-devkit/blob/main/tests/integration/consent-flow.test.ts) |
| Consent requests and record fetches, with approvals and safety checks | Mock-tested | [Consent](https://github.com/yellowparrottech/abdm-devkit/blob/main/packages/workflows/src/consent-workflows.test.ts), [records](https://github.com/yellowparrottech/abdm-devkit/blob/main/packages/workflows/src/health-info-workflows.test.ts), [review fixes](https://github.com/yellowparrottech/abdm-devkit/blob/main/packages/workflows/src/review-regressions.test.ts) |
| ABDM's encryption | Vector-tested: all 7 published reference examples; real ABDM data not yet tried | [Tests](https://github.com/yellowparrottech/abdm-devkit/blob/main/packages/crypto-adapter/src/fidelius.test.ts), [reference examples](https://github.com/yellowparrottech/abdm-devkit/tree/main/packages/crypto-adapter/test-vectors) |
| Building and checking health records (FHIR) | Partial: structure checks only; full format checks planned | [Tests](https://github.com/yellowparrottech/abdm-devkit/blob/main/packages/fhir/src/fhir.test.ts) |
| AI assistant tools (MCP) and Claude Desktop extension | Mock-tested with the official MCP client libraries; not yet tried in Claude Desktop | [Tools](https://github.com/yellowparrottech/abdm-devkit/blob/main/packages/mcp-adapter/src/server.test.ts), [running server](https://github.com/yellowparrottech/abdm-devkit/blob/main/tests/e2e/stdio-server.test.ts) |
| REST API and command-line tool | Mock-tested | [Tests](https://github.com/yellowparrottech/abdm-devkit/blob/main/packages/rest-adapter/src/app.test.ts) |
| Receiving ABDM's messages on a server (callback bridge) | Experimental | [Bridge](https://github.com/yellowparrottech/abdm-devkit/blob/main/apps/callback-bridge/src/bridge.test.ts), [encryption](https://github.com/yellowparrottech/abdm-devkit/blob/main/apps/callback-bridge/src/encrypted-store.test.ts), [collecting](https://github.com/yellowparrottech/abdm-devkit/blob/main/tests/integration/bridge-inbox.test.ts) |
| Connecting to ABDM's test system (sandbox) | Not yet verified: waiting for sandbox access | None yet |
| Use with real patient data | Not available | None |
