# Python example

Consent and record fetch over the DevKit's REST API, using only the Python standard library.

```sh
pnpm install && pnpm build
node apps/cli/dist/main.js mock          # prints ABDM_DEVKIT_TOKEN=...
ABDM_DEVKIT_TOKEN=... python3 examples/python/consent_and_fetch.py
```

The script prepares a consent request, shows you the summary and asks `Approve and send? [y/N]`, sends it only if you answer `y`, waits for the simulated patient, then does the same for a record fetch and prints the decrypted synthetic records. Pass `--yes` to approve automatically in unattended demos.

A real app must also authenticate the person who approves: the DevKit checks that an approval matches the exact request and user, but cannot tell a person from a script.
