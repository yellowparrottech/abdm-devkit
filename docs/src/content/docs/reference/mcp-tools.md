---
title: AI assistant tools (MCP)
description: The eight tools AI assistants such as Claude can use, and which ones need your confirmation.
---

**MCP** (Model Context Protocol) is the standard way AI assistants use tools. These are the DevKit's tools. Tools that send anything always show you the exact request and wait for your confirmation.

| Tool | What it does | Sends anything |
| --- | --- | --- |
| `abdm_demo_scenarios` | Practice ABDM only: list how the simulated patient can respond | No |
| `abdm_consent_request` | Request patient consent, after the user confirms | Yes |
| `abdm_consent_status` | Whether the patient has approved, and exactly what | No |
| `abdm_health_info_request` | Fetch records the patient agreed to share, after the user confirms | Yes |
| `abdm_health_info_result` | Records received for a fetch, where allowed; otherwise types and sizes | No |
| `abdm_workflow_status` | Every consent request and fetch by the current user | No |
| `abdm_fhir_generate` | Build a health record in ABDM's format (FHIR), with a check report | No |
| `abdm_fhir_validate` | Check a health record's structure | No |

If your AI assistant cannot show confirmation prompts (MCP calls them "elicitation"), the tools that send requests stop with an error and nothing is sent.
