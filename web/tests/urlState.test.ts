import { describe, expect, it } from "vitest";
import { parseViewState, serializeViewState, type ViewState } from "@/lib/urlState";

const known = {
  geoIds: new Set(["US", "CBSA:12420"]),
  seriesIds: new Set(["a", "b", "c", "d", "e", "f", "g", "h"]),
};
const parse = (q: string) => parseViewState(new URLSearchParams(q), known);

describe("urlState", () => {
  it("empty params give defaults with no warnings", () => {
    expect(parse("")).toEqual({
      state: { geo: "US", series: [], transform: "level", range: "10y" },
      warnings: [],
    });
  });

  it("round-trips valid states", () => {
    const states: ViewState[] = [
      { geo: "US", series: [], transform: "level", range: "10y" },
      {
        geo: "CBSA:12420",
        series: ["a", "c"],
        transform: "rebased",
        range: "5y",
        rebase: "2020-01-01",
      },
      {
        geo: "US",
        series: ["b"],
        transform: "yoy",
        range: { start: "2015-01-01", end: "2020-12-31" },
      },
    ];
    for (const s of states)
      expect(parse(serializeViewState(s))).toEqual({ state: s, warnings: [] });
  });

  it("keeps ':' and ',' literal in share URLs", () => {
    const s: ViewState = {
      geo: "CBSA:12420",
      series: ["a", "b"],
      transform: "level",
      range: "10y",
    };
    expect(serializeViewState(s)).toBe("geo=CBSA:12420&s=a,b");
    expect(parse("geo=CBSA%3A12420&s=a%2Cb").state).toEqual(s);
  });

  it("serialize omits defaults", () => {
    expect(serializeViewState({ geo: "US", series: [], transform: "level", range: "10y" })).toBe(
      "",
    );
  });

  it("bad input falls back to defaults with one warning per problem", () => {
    const { state, warnings } = parse("geo=XX&s=zz,a,b,c,d,e,f,g,h&t=banana");
    expect(state).toEqual({
      geo: "US",
      series: ["a", "b", "c", "d", "e", "f"],
      transform: "level",
      range: "10y",
    });
    expect(warnings).toHaveLength(4);
  });

  it("dedupes series", () => {
    expect(parse("s=a,a,b").state.series).toEqual(["a", "b"]);
  });

  it("invalid range and rebase fall back with warnings", () => {
    const { state, warnings } = parse("r=2020-01-01..2019-01-01&b=2020-13-01");
    expect(state.range).toBe("10y");
    expect(state.rebase).toBeUndefined();
    expect(warnings).toHaveLength(2);
    expect(parse("r=3y").warnings).toHaveLength(1);
    const bad = parse("r=2020-13-45..x");
    expect(bad.state.range).toBe("10y");
    expect(bad.warnings).toHaveLength(1);
  });
});
