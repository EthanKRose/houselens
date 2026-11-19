import { describe, expect, it } from "vitest";
import { freshnessStatus } from "@/lib/freshness";

const f = {
  last_period_end: "2026-09-30",
  last_release_date: null,
  last_ingest_at: null,
  frequency: "monthly" as const,
  typical_lag_days: 30,
};
// expected = 2026-09-30 + 30 + 31 days = 2026-11-30; amber until +15.5 days.
const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("freshnessStatus", () => {
  it("green up to and including the expected date", () => {
    expect(freshnessStatus(f, at("2026-11-30"))).toBe("green");
  });
  it("amber up to expected + cadence/2", () => {
    expect(freshnessStatus(f, at("2026-12-01"))).toBe("amber");
    expect(freshnessStatus(f, at("2026-12-15"))).toBe("amber");
  });
  it("red after that", () => {
    expect(freshnessStatus(f, at("2026-12-16"))).toBe("red");
  });
  it("treats a null lag as 0 and uses weekly cadence", () => {
    const w = {
      ...f,
      frequency: "weekly" as const,
      typical_lag_days: null,
      last_period_end: "2026-11-01",
    };
    expect(freshnessStatus(w, at("2026-11-08"))).toBe("green");
    expect(freshnessStatus(w, at("2026-11-11"))).toBe("amber");
    expect(freshnessStatus(w, at("2026-11-12"))).toBe("red");
  });
});
