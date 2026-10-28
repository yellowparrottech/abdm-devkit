# @yellowparrottech/abdm-fixtures

Seeded synthetic data. The same seed always produces the same records.

- `syntheticPatients(seed, count)`: patients with `00`-prefixed ABHA numbers, `@sbx` ABHA addresses and mobile numbers that cannot be real. Never send them to a real ABDM environment.
- `DEMO_HIU_ID`, `DEMO_HIP_ID`: facility IDs shared by examples and tests.

Pre-release; not yet published to npm.
