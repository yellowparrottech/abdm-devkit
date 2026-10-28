# @yellowparrottech/abdm-crypto

ABDM's health-data encryption scheme ("Fidelius"), written from scratch on [`@noble/curves`](https://github.com/paulmillr/noble-curves) (MIT, audited) and Web Crypto, so it runs in Node.js, Cloudflare Workers and browsers.

- ECDH on Curve25519 in short Weierstrass form, the form ABDM's Java reference uses.
- The XOR of both parties' 32-byte nonces gives the HKDF-SHA256 salt (first 20 bytes) and the AES-256-GCM IV (last 12 bytes).
- Public keys are accepted as a raw 65-byte point or as X.509, and generated in both forms.

```ts
import { decryptToString, encrypt, generateKeyMaterial } from "@yellowparrottech/abdm-crypto";

const hiu = generateKeyMaterial(); // send hiu.x509PublicKey and hiu.nonce in the key material
const hip = generateKeyMaterial();
const encryptedData = await encrypt({ plaintext: bundleJson, senderPrivateKey: hip.privateKey, senderNonce: hip.nonce, receiverPublicKey: hiu.x509PublicKey, receiverNonce: hiu.nonce });
const bundle = await decryptToString({ encryptedData, receiverPrivateKey: hiu.privateKey, receiverNonce: hiu.nonce, senderPublicKey: hip.publicKey, senderNonce: hip.nonce });
```

## Verification

- Reproduces all 7 published fidelius-cli 1.2.0 vectors exactly: ciphertext, shared secret and X.509 key encoding (`test-vectors/`, MIT, see its README).
- Curve parameters are checked in tests: the generator is on the curve, maps to the X25519 base point, and has order n.
- Still to do: round trips with real encrypted data from the ABDM sandbox.

Pre-release; not yet published to npm.
