/** Where ABDM calls go. `mock` needs no credentials and is the default. */
export type AbdmEnvironment = "mock" | "sandbox" | "certified";

export const DEFAULT_ENVIRONMENT: AbdmEnvironment = "mock";
