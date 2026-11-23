import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  flip,
  liveIn,
  monthlyPayment,
  pctVs,
  rental,
  signals,
  type Assumptions,
} from "@/lib/deal";

const A: Assumptions = { ...DEFAULTS, ratePct: 6 };

describe("monthlyPayment", () => {
  it("matches the standard amortization formula", () => {
    // $300,000 at 6% for 30 years = $1,798.65 (published amortization tables)
    expect(monthlyPayment(300_000, 6, 30)).toBeCloseTo(1798.65, 2);
  });
  it("handles a 0% rate and a $0 loan", () => {
    expect(monthlyPayment(360_000, 0, 30)).toBe(1000);
    expect(monthlyPayment(0, 6, 30)).toBe(0);
  });
});

describe("pctVs", () => {
  it("is the % above (+) or below (-) the benchmark", () => {
    expect(pctVs(110, 100)).toBeCloseTo(10);
    expect(pctVs(90, 100)).toBeCloseTo(-10);
    expect(pctVs(90, 0)).toBeNull();
    expect(pctVs(90, null)).toBeNull();
  });
});

describe("liveIn", () => {
  it("adds loan payment, tax, insurance and HOA", () => {
    const r = liveIn(375_000, { ...A, downPct: 20, taxPct: 1.2, insuranceYr: 1800, hoaMo: 50 });
    expect(r.loan).toBe(300_000);
    expect(r.principalInterest).toBeCloseTo(1798.65, 2);
    expect(r.tax).toBeCloseTo(375, 6); // 1.2% of 375k / 12
    expect(r.insurance).toBe(150);
    expect(r.total).toBeCloseTo(1798.65 + 375 + 150 + 50, 2);
    expect(r.cashToClose).toBeCloseTo(75_000 + 375_000 * (A.closingPct / 100), 6);
  });
  it("needs no loan at 100% down", () => {
    expect(liveIn(200_000, { ...A, downPct: 100 }).principalInterest).toBe(0);
  });
});

describe("rental", () => {
  const r = rental(200_000, 2_000, {
    ...A,
    downPct: 25,
    taxPct: 1,
    insuranceYr: 1200,
    hoaMo: 0,
    vacancyPct: 5,
    otherExpensePct: 20,
  });
  it("computes yields and cash flow from rent and costs", () => {
    expect(r.grossYieldPct).toBeCloseTo(12); // 24,000 / 200,000
    expect(r.onePctRule).toBeCloseTo(1);
    // income 24,000 * 0.95 = 22,800; costs: tax 2,000 + ins 1,200 + other 20% of 24,000 = 4,800
    expect(r.noiYr).toBeCloseTo(22_800 - 2_000 - 1_200 - 4_800);
    expect(r.capRatePct).toBeCloseTo((14_800 / 200_000) * 100);
    const pi = monthlyPayment(150_000, 6, 30);
    expect(r.cashFlowMo).toBeCloseTo(14_800 / 12 - pi, 6);
    expect(r.cashOnCashPct).toBeCloseTo(((r.cashFlowMo! * 12) / r.cashInvested) * 100, 6);
  });
  it("returns no yield when the rent is unknown", () => {
    expect(rental(200_000, null, A).grossYieldPct).toBeNull();
  });
});

describe("flip", () => {
  it("subtracts purchase, rehab, holding and selling costs from the resale value", () => {
    const f = flip(200_000, 300_000, {
      ...A,
      rehab: 40_000,
      holdMonths: 6,
      sellingPct: 8,
      closingPct: 3,
    });
    // While held, only interest is a cost (principal paid builds equity in the price already counted).
    const own = liveIn(200_000, { ...A, closingPct: 3 });
    const hold = ((own.loan * 0.06) / 12 + own.tax + own.insurance + own.hoa) * 6;
    const cost = 200_000 + 6_000 + 40_000 + hold + 24_000;
    expect(f.totalCost).toBeCloseTo(cost, 6);
    expect(f.profit).toBeCloseTo(300_000 - cost, 6);
    expect(f.seventyPctMaxPrice).toBeCloseTo(300_000 * 0.7 - 40_000);
  });
  it("has no profit figure without a resale value", () => {
    expect(flip(200_000, null, A).profit).toBeNull();
  });
});

describe("signals", () => {
  it("rates a home priced well under the area as good, and explains why", () => {
    const s = signals("live", {
      priceVsValuePct: -12,
      ppsfVsAreaPct: -8,
      domDays: 70,
      priceCutSharePct: 30,
    });
    expect(s[0]).toEqual({ level: "good", text: expect.stringMatching(/12% below/) });
    expect(s.some((x) => x.level === "good" && /negotiat/i.test(x.text))).toBe(true);
  });
  it("flags negative rental cash flow as bad", () => {
    const s = signals("rental", { cashFlowMo: -150, capRatePct: 3.5, onePctRule: 0.5 });
    expect(s.filter((x) => x.level === "bad")).toHaveLength(3);
  });
  it("names what the price was compared with", () => {
    const s = signals("live", { priceVsValuePct: 8, valueWhat: "the metro's typical home value" });
    expect(s[0].text).toBe("8% above the metro's typical home value.");
  });
  it("skips checks it has no numbers for", () => {
    expect(signals("live", {})).toEqual([]);
  });
});
