"""Consent and record fetch against the DevKit's REST API, using only the Python standard library.

Start the mock environment first (synthetic data only):

    node apps/cli/dist/main.js mock

then run, with the token it prints:

    ABDM_DEVKIT_TOKEN=... python3 examples/python/consent_and_fetch.py

It asks you to approve each request before sending it. Add --yes to approve automatically,
for unattended demos only.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE_URL = os.environ.get("ABDM_DEVKIT_URL", "http://127.0.0.1:8787/v1")
TOKEN = os.environ["ABDM_DEVKIT_TOKEN"]
HIU_ID = os.environ.get("ABDM_DEVKIT_HIU_ID", "HIU-DEMO-01")
AUTO_APPROVE = "--yes" in sys.argv


def call(method, path, body=None):
    request = urllib.request.Request(
        BASE_URL + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{method} {path} failed with {error.code}: {error.read().decode()}")


def confirm(summary):
    """Show the request to the person running this script and ask them to approve it.

    The DevKit checks that the approval matches this exact request and user. A real app must also
    authenticate the person who approves; the DevKit cannot tell a person from a script.
    """
    print("\n".join("  " + line for line in summary))
    if AUTO_APPROVE:
        print("  Approved automatically (--yes).")
        return True
    if not sys.stdin.isatty():
        raise SystemExit("Nobody to ask for approval. Run this in a terminal, or pass --yes for an unattended demo.")
    return input("Approve and send? [y/N]: ").strip().lower() == "y"


def wait_for(path, field, done_value, attempts=60):
    for _ in range(attempts):
        result = call("GET", path)
        if result[field] == done_value:
            return result
        time.sleep(0.5)
    raise SystemExit(f"Timed out waiting for {path} to reach {done_value}")


year = {"from": "2025-01-01T00:00:00.000Z", "to": "2025-12-31T23:59:59.000Z"}
consent_request = {
    "patientAbhaAddress": "asha.rao1@sbx",
    "hiuId": HIU_ID,
    "requesterName": "Python example",
    "purpose": "CAREMGT",
    "hiTypes": ["Prescription", "DiagnosticReport"],
    "dateRange": year,
    "expiresAt": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
}

print("Consent request to approve:")
pending = call("POST", "/consent-requests/prepare", consent_request)
if not confirm(pending["summary"]):
    raise SystemExit("Cancelled. Nothing was sent to ABDM.")
sent = call("POST", "/consent-requests", {"approvalId": pending["approvalId"], "request": consent_request})

print("Waiting for the simulated patient to respond...")
consent = wait_for(f"/consent-requests/{sent['requestId']}", "state", "granted")
artefact = consent["artefacts"][0]
print(f"Granted by {artefact['hipId']} for {', '.join(artefact['hiTypes'])}")

fetch = {"requestId": sent["requestId"], "artefactId": artefact["id"], "hiTypes": ["Prescription"], "dateRange": year}
print("\nFetch to approve:")
pending = call("POST", "/health-info-requests/prepare", fetch)
if not confirm(pending["summary"]):
    raise SystemExit("Cancelled. Nothing was sent to ABDM.")
requested = call("POST", "/health-info-requests", {"approvalId": pending["approvalId"], "request": fetch})

print("Waiting for the encrypted records...")
result = wait_for(f"/health-info-requests/{requested['transactionId']}", "state", "received")
for record in result["records"]:
    composition = record["bundle"]["entry"][0]["resource"]
    print(f"Received {record['hiType']}: {composition['title']} ({record['sizeBytes']} bytes, decrypted by the DevKit)")
