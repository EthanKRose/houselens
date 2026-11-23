/** Deal math for the property analyzer. Pure functions; every input is an editable assumption. */

/** Costs and financing a visitor can edit. Percentages are 0-100. */
export type Assumptions = {
  downPct: number;
  ratePct: number;
  taxPct: number;
  insuranceYr: number;
  hoaMo: number;
  closingPct: number;
  vacancyPct: number;
  /** Maintenance, management and repairs, as % of rent. */
  otherExpensePct: number;
  rehab: number;
  holdMonths: number;
  sellingPct: number;
};

/** Starting assumptions; the page replaces ratePct with the latest 30-year rate. */
export const DEFAULTS: Assumptions = {
  downPct: 20,
  ratePct: 6.5,
  taxPct: 1,
  insuranceYr: 1500,
  hoaMo: 0,
  closingPct: 3,
  vacancyPct: 5,
  otherExpensePct: 20,
  rehab: 0,
  holdMonths: 6,
  sellingPct: 8,
};

const YEARS = 30;

/**
 * Monthly principal and interest on a fixed-rate loan.
 * @param principal - amount borrowed
 * @param ratePct - annual rate, e.g. 6.5
 * @param years - loan term
 * @returns the monthly payment
 */
export function monthlyPayment(principal: number, ratePct: number, years: number): number {
  if (principal <= 0) return 0;
  const n = years * 12;
  const r = ratePct / 100 / 12;
  return r === 0 ? principal / n : (principal * r) / (1 - (1 + r) ** -n);
}

/**
 * How far a value sits above (+) or below (-) a benchmark, in percent.
 * @param value - the property's figure
 * @param benchmark - the area figure, if known
 * @returns the % difference, or null without a usable benchmark
 */
export function pctVs(value: number, benchmark: number | null | undefined): number | null {
  return benchmark ? (value / benchmark - 1) * 100 : null;
}

/**
 * Monthly cost of owning the home to live in.
 * @param price - purchase price
 * @param a - assumptions
 * @returns the loan, each monthly cost, the total, and cash needed at closing
 */
export function liveIn(price: number, a: Assumptions) {
  const loan = price * (1 - a.downPct / 100);
  const principalInterest = monthlyPayment(loan, a.ratePct, YEARS);
  const tax = (price * a.taxPct) / 100 / 12;
  const insurance = a.insuranceYr / 12;
  return {
    loan,
    principalInterest,
    tax,
    insurance,
    hoa: a.hoaMo,
    total: principalInterest + tax + insurance + a.hoaMo,
    cashToClose: (price * (a.downPct + a.closingPct)) / 100,
  };
}

/**
 * Rental returns.
 * @param price - purchase price
 * @param rentMo - expected monthly rent, or null if unknown
 * @param a - assumptions
 * @returns yields, net operating income, cash flow and cash-on-cash return (null without rent)
 */
export function rental(price: number, rentMo: number | null, a: Assumptions) {
  const own = liveIn(price, a);
  if (rentMo === null) {
    return {
      grossYieldPct: null, onePctRule: null, noiYr: null, capRatePct: null,
      cashFlowMo: null, cashInvested: own.cashToClose, cashOnCashPct: null,
    }; // prettier-ignore
  }
  const rentYr = rentMo * 12;
  const income = rentYr * (1 - a.vacancyPct / 100);
  const expenses =
    (price * a.taxPct) / 100 + a.insuranceYr + a.hoaMo * 12 + (rentYr * a.otherExpensePct) / 100;
  const noiYr = income - expenses;
  const cashFlowMo = noiYr / 12 - own.principalInterest;
  return {
    grossYieldPct: (rentYr / price) * 100,
    onePctRule: (rentMo / price) * 100,
    noiYr,
    capRatePct: (noiYr / price) * 100,
    cashFlowMo,
    cashInvested: own.cashToClose,
    cashOnCashPct: own.cashToClose > 0 ? ((cashFlowMo * 12) / own.cashToClose) * 100 : null,
  };
}

/**
 * Flip (buy, renovate, resell) estimate.
 * @param price - purchase price
 * @param resale - expected resale value (an area typical value, not an appraisal), or null
 * @param a - assumptions (rehab, months held, selling costs, financing while held)
 * @returns total cost, profit, margin and the "70% rule" maximum price (null without resale)
 */
export function flip(price: number, resale: number | null, a: Assumptions) {
  // Only interest is a holding cost: principal repaid is part of the price, already counted.
  const own = liveIn(price, a);
  const holding =
    ((own.loan * a.ratePct) / 100 / 12 + own.tax + own.insurance + own.hoa) * a.holdMonths;
  const selling = resale === null ? 0 : (resale * a.sellingPct) / 100;
  const totalCost = price + (price * a.closingPct) / 100 + a.rehab + holding + selling;
  const profit = resale === null ? null : resale - totalCost;
  return {
    holding,
    totalCost,
    profit,
    marginPct: profit === null || !resale ? null : (profit / resale) * 100,
    seventyPctMaxPrice: resale === null ? null : resale * 0.7 - a.rehab,
  };
}

/** One plain-English check on a deal. */
export type Signal = { level: "good" | "ok" | "bad"; text: string };

/** Numbers the checks look at; any may be missing. */
export type SignalInputs = {
  priceVsValuePct?: number | null;
  ppsfVsAreaPct?: number | null;
  domDays?: number | null;
  priceCutSharePct?: number | null;
  cashFlowMo?: number | null;
  capRatePct?: number | null;
  onePctRule?: number | null;
  marginPct?: number | null;
  price?: number;
  seventyPctMaxPrice?: number | null;
  /** What the price was compared with; defaults to similar homes in the ZIP. */
  valueWhat?: string;
  /** What the price per sq ft was compared with; defaults to the ZIP's median. */
  ppsfWhat?: string;
};

const n0 = (x: number) => Math.abs(Math.round(x));
const usd = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
const has = (x: number | null | undefined): x is number => typeof x === "number";

function vsArea(pct: number, what: string): Signal {
  if (pct <= -5) return { level: "good", text: `${n0(pct)}% below ${what}.` };
  if (pct <= 5)
    return { level: "ok", text: `Close to ${what} (${pct >= 0 ? "+" : "-"}${n0(pct)}%).` };
  return { level: "bad", text: `${n0(pct)}% above ${what}.` };
}

/**
 * Rule-of-thumb checks for one use of the property; checks without numbers are skipped.
 * @param mode - "live", "rental" or "flip"
 * @param m - the numbers available
 * @returns checks, most important first
 */
export function signals(mode: "live" | "rental" | "flip", m: SignalInputs): Signal[] {
  const out: Signal[] = [];
  if (has(m.priceVsValuePct)) {
    out.push(
      vsArea(m.priceVsValuePct, m.valueWhat ?? "the typical value of similar homes in this ZIP"),
    );
  }
  if (mode === "live") {
    if (has(m.ppsfVsAreaPct))
      out.push(
        vsArea(m.ppsfVsAreaPct, m.ppsfWhat ?? "the ZIP's median asking price per square foot"),
      );
    if (has(m.domDays)) {
      out.push(
        m.domDays >= 60
          ? {
              level: "good",
              text: `Homes here stay listed about ${n0(m.domDays)} days: buyers have room to negotiate.`,
            }
          : m.domDays <= 20
            ? {
                level: "bad",
                text: `Homes here sell in about ${n0(m.domDays)} days: expect competing offers.`,
              }
            : { level: "ok", text: `Homes here stay listed about ${n0(m.domDays)} days.` },
      );
    }
    if (has(m.priceCutSharePct)) {
      out.push(
        m.priceCutSharePct >= 25
          ? {
              level: "good",
              text: `${n0(m.priceCutSharePct)}% of listings here cut their price: sellers are negotiating.`,
            }
          : { level: "ok", text: `${n0(m.priceCutSharePct)}% of listings here cut their price.` },
      );
    }
  }
  if (mode === "rental") {
    if (has(m.cashFlowMo)) {
      out.push(
        m.cashFlowMo > 0
          ? {
              level: "good",
              text: `Earns about ${usd(m.cashFlowMo)} a month after the mortgage and costs.`,
            }
          : {
              level: "bad",
              text: `Loses about ${usd(-m.cashFlowMo)} a month after the mortgage and costs.`,
            },
      );
    }
    if (has(m.capRatePct)) {
      const t = `Cap rate ${m.capRatePct.toFixed(1)}% (income after costs, before the mortgage, as % of price)`;
      out.push({
        level: m.capRatePct >= 6 ? "good" : m.capRatePct >= 4 ? "ok" : "bad",
        text: `${t}.`,
      });
    }
    if (has(m.onePctRule)) {
      const t = `Monthly rent is ${m.onePctRule.toFixed(2)}% of the price; investors often look for 1%`;
      out.push({
        level: m.onePctRule >= 1 ? "good" : m.onePctRule >= 0.7 ? "ok" : "bad",
        text: `${t}.`,
      });
    }
  }
  if (mode === "flip") {
    if (has(m.marginPct)) {
      const t = `Estimated profit is ${m.marginPct.toFixed(0)}% of the resale value`;
      out.push({
        level: m.marginPct >= 15 ? "good" : m.marginPct >= 5 ? "ok" : "bad",
        text: `${t}.`,
      });
    }
    if (has(m.seventyPctMaxPrice) && has(m.price)) {
      out.push(
        m.price <= m.seventyPctMaxPrice
          ? {
              level: "good",
              text: `Price is within the "70% rule" (at most ${usd(m.seventyPctMaxPrice)}).`,
            }
          : {
              level: "bad",
              text: `Price is over the "70% rule" maximum of ${usd(m.seventyPctMaxPrice)}.`,
            },
      );
    }
  }
  return out;
}
