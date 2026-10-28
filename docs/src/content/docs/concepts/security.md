---
title: Security and privacy
description: How the DevKit protects health data and identity numbers, especially when AI assistants are involved.
sidebar:
  order: 3
---

## What each user can see

Reading records changes nothing, but it can reveal very sensitive information. So the DevKit decides what can be seen by how sensitive it is, and enforces this on the server, not in the AI assistant.

| Information | Who can see it |
| --- | --- |
| Practice scenarios, health-record checks | Anyone using the DevKit |
| Made-up records | Anyone, in the practice ABDM |
| Status of consents and fetches | Only the user who made them |
| Real record contents | Nobody through the DevKit, unless the operator declares a controlled setup for it |
| Aadhaar numbers and one-time passwords | Never shown to an AI assistant |

## Safety rules

- **Your app decides who the user is**, never the AI assistant.
- **Every request needs an approval** tied to one user and one exact request, used once and expiring after 10 minutes. The DevKit enforces this; **your app** (or your AI assistant's confirmation prompt) is what shows the request to a person. The DevKit cannot tell whether a human or a script answered, so production apps must authenticate the person approving.
- **Record contents shown to an AI assistant are size-limited and marked as untrusted**, so instructions hidden inside a record are not followed.
- **The audit log never contains patient details or record contents.**
- **Passwords, keys and ABDM access tokens stay on the server.**

## Code reviews so far

In October 2026 the code had two internal reviews, each done by an AI agent working separately from the author and given only the code. They found eight defects, including two record deliveries being accepted at once, records kept after consent was withdrawn, and replayed callbacks being accepted. All eight are fixed, each with an automated test that fails if the problem comes back.

These were **not independent or third-party security audits**. An external review is planned before the DevKit is used with real patient data.

## Reporting a problem

Please report security issues privately through the **Security** tab of the GitHub repository, not in a public issue.
