# @yellowparrottech/abdm-devkit

Command-line tool for the YellowParrot ABDM DevKit.

```sh
pnpm build
node apps/cli/dist/main.js mock --port 8787
```

`mock` runs the mock ABDM environment (synthetic data only) as a REST API on `127.0.0.1`. It prints a bearer token that is new on every run; send it as `Authorization: Bearer <token>`. API reference: `@yellowparrottech/abdm-rest-adapter`. Example client: `examples/python`.

Pre-release; not yet published to npm.
