import { err, ok, type Result } from "@yellowparrottech/abdm-core";

export type ApiVersion = "v2" | "v3";

/** API versions each flow can use. M1 (ABHA) is V3 only; see docs/adr/0001. */
export const SUPPORTED_VERSIONS = {
  abha: ["v3"],
  hipLinking: ["v2", "v3"],
  hipDataTransfer: ["v2", "v3"],
  hiuConsent: ["v2", "v3"],
  hiuDataFetch: ["v2", "v3"],
} as const satisfies Record<string, readonly ApiVersion[]>;

export type Flow = keyof typeof SUPPORTED_VERSIONS;
export type VersionPolicy = { [F in Flow]: (typeof SUPPORTED_VERSIONS)[F][number] };

export const DEFAULT_VERSION_POLICY: VersionPolicy = {
  abha: "v3",
  hipLinking: "v3",
  hipDataTransfer: "v3",
  hiuConsent: "v3",
  hiuDataFetch: "v3",
};

export type VersionPolicyError =
  | { code: "unknown_flow"; flow: string }
  | { code: "unsupported_version"; flow: Flow; version: string; supported: readonly ApiVersion[] };

/** Apply operator overrides, such as `{ hiuConsent: "v2" }`, to the default policy. */
export function resolveVersionPolicy(overrides: Record<string, string | undefined> = {}): Result<VersionPolicy, VersionPolicyError> {
  const policy: Record<string, string> = { ...DEFAULT_VERSION_POLICY };
  for (const [flow, version] of Object.entries(overrides)) {
    if (version === undefined) continue;
    if (!isFlow(flow)) return err({ code: "unknown_flow", flow });
    const supported: readonly string[] = SUPPORTED_VERSIONS[flow];
    if (!supported.includes(version)) return err({ code: "unsupported_version", flow, version, supported: SUPPORTED_VERSIONS[flow] });
    policy[flow] = version;
  }
  return ok(policy as VersionPolicy);
}

function isFlow(name: string): name is Flow {
  return Object.hasOwn(SUPPORTED_VERSIONS, name);
}
