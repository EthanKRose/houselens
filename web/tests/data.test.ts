import { describe, expect, it } from "vitest";
import { geoFileName, toPoints } from "@/lib/data";

describe("data helpers", () => {
  it("maps geo ids to file names", () => {
    expect(geoFileName("CBSA:12420")).toBe("CBSA_12420");
  });
  it("converts raw tuples to points", () => {
    expect(toPoints([["2024-01-01", "2024-01-31", 5, ["x"]]])).toEqual([
      { start: "2024-01-01", end: "2024-01-31", value: 5, flags: ["x"] },
    ]);
  });
});
