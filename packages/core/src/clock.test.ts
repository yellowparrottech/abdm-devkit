import { describe, expect, it } from "vitest";
import { DEFAULT_ENVIRONMENT, ManualClock } from "./index.js";

describe("core", () => {
  it("defaults to the mock environment", () => {
    expect(DEFAULT_ENVIRONMENT).toBe("mock");
  });

  it("moves a manual clock only forwards", () => {
    const clock = new ManualClock("2026-03-01T10:00:00.000Z");
    clock.advance(60_000);
    expect(clock.now().toISOString()).toBe("2026-03-01T10:01:00.000Z");
    expect(() => clock.advance(-1)).toThrow(RangeError);
  });
});
