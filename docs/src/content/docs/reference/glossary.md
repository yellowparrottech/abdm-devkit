---
title: Glossary
description: Plain explanations of the ABDM, health-data and technical terms used in these docs.
---

## ABDM terms

**ABDM**: Ayushman Bharat Digital Mission, India's national system for sharing health records with the patient's consent. Run by the National Health Authority (NHA).

**ABHA**: Ayushman Bharat Health Account. A person's health ID: a 14-digit number plus an easy address such as `asha.rao@abdm`. Sandbox addresses end in `@sbx`.

**ABHA app**: an app (such as NHA's own, or one from a certified company) where a person sees and approves consent requests.

**Artefact (consent artefact)**: the record of what a patient actually approved: which hospital, which record types, which dates, until when. A patient can approve less than was asked, so the artefact can be narrower than the request.

**Care context**: one visit or episode at a hospital (for example, an outpatient visit) that the hospital has linked to the patient's ABHA.

**Certification**: NHA's approval for software to use real ABDM data: at least two milestones, functional testing by an approved agency, and a security audit.

**Consent manager**: the part of ABDM that asks patients for consent and keeps track of what they approved.

**Gateway**: the part of ABDM that passes requests and replies between hospitals, clinics and the consent manager.

**HI types (health information types)**: the eight kinds of record ABDM shares: OP consultation, prescription, diagnostic report, discharge summary, immunization record, health document, wellness record and invoice.

**HIP (health information provider)**: a facility that holds records and sends them when consent allows, such as the hospital where you were treated.

**HIU (health information user)**: a facility or app that asks for consent and receives records, such as a clinic you visit next.

**Milestones (M1, M2, M3)**: the three parts NHA certifies. M1: create and verify ABHA IDs. M2: link and share your records (acting as a HIP). M3: request consent and receive records (acting as a HIU).

**NRCeS**: National Resource Centre for EHR Standards, which publishes the FHIR formats ABDM uses.

**Sandbox**: NHA's test version of ABDM, with test data, for building and testing before certification.

## Health-data terms

**FHIR**: Fast Healthcare Interoperability Resources, the international standard format for health records. ABDM records are FHIR "document bundles": one file holding the patient, the author and the clinical details.

**Synthetic data**: made-up data that looks realistic. Everything in the DevKit's mock environment and repository is synthetic.

## Technical terms

**202 Accepted**: the reply ABDM expects immediately when it calls you. It means "received, will process".

**Callback**: a message ABDM sends to your server later, such as "the patient approved". Whether, and how often, ABDM retries a callback it could not deliver has not been confirmed for each endpoint, so software must cope with missing, late and repeated callbacks.

**Callback bridge**: the DevKit's small, self-hosted service that durably records the callbacks it receives and keeps them until the DevKit collects them.

**Elicitation**: the way an MCP server asks the person using an AI assistant to confirm something. The DevKit uses it to show each request and wait for "yes".

**Encryption (Fidelius)**: the scheme ABDM uses so that only the intended receiver can read a record. See [Encryption](/concepts/encryption/).

**MCP (Model Context Protocol)**: an open standard that lets AI assistants such as Claude use tools. The DevKit provides eight.

**Mock**: the DevKit's built-in stand-in for ABDM and a hospital, so you can try everything without credentials.

**REST API**: a way for any program to use the DevKit over HTTP, from any programming language.

**V2, V3**: versions of ABDM's APIs. V3 is current; for M2 and M3 the DevKit can use either.
