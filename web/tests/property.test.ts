import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exportSaved,
  importSaved,
  loadSaved,
  parsePropertyParams,
  saveSaved,
  serializeProperty,
  type Property,
} from "@/lib/property";

const P: Property = {
  id: "a",
  zip: "78704",
  price: 549900,
  beds: 3,
  baths: 2,
  sqft: 1850,
  mode: "live",
  savedAt: "2026-11-23",
};

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("saved properties", () => {
  it("round-trips through browser storage", () => {
    expect(saveSaved([P])).toBe(true);
    expect(loadSaved()).toEqual([P]);
  });
  it("survives blocked or corrupt storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadSaved()).toEqual([]);
    expect(saveSaved([P])).toBe(false);
    vi.restoreAllMocks();
    localStorage.setItem("houselens.properties.v1", "{not json");
    expect(loadSaved()).toEqual([]);
  });
  it("imports a backup, dropping invalid entries and keeping existing ones", () => {
    const backup = exportSaved([P, { ...P, id: "b", zip: "8701" } as Property]);
    expect(importSaved(backup, [{ ...P, id: "c" }]).map((p) => p.id)).toEqual(["c", "a"]);
    expect(() => importSaved("nope", [])).toThrow(/not a HouseLens backup/);
  });
});

describe("share links", () => {
  it("round-trips the inputs and leaves the address out unless asked", () => {
    const q = serializeProperty({ ...P, address: "1234 S Congress Ave" }, false);
    expect(q).toBe("z=78704&p=549900&bd=3&ba=2&sf=1850");
    expect(parsePropertyParams(new URLSearchParams(q))).toEqual({
      zip: "78704",
      price: 549900,
      beds: 3,
      baths: 2,
      sqft: 1850,
      mode: "live",
    });
    const withAddr = serializeProperty(
      { ...P, address: "1234 S Congress Ave", mode: "rental" },
      true,
    );
    expect(parsePropertyParams(new URLSearchParams(withAddr))).toMatchObject({
      address: "1234 S Congress Ave",
      mode: "rental",
    });
  });
  it("ignores invalid values instead of trusting them", () => {
    expect(parsePropertyParams(new URLSearchParams("z=7870&p=-5&bd=abc&m=evil&sf=0"))).toEqual({
      mode: "live",
    });
  });
});
