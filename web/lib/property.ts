/** A property a visitor is analyzing: browser-only saving, backups and share links. */

import { DEFAULTS, type Assumptions } from "./deal";

/** Which use the visitor is judging the property for. */
export type Mode = "live" | "rental" | "flip";

/** One property; only ZIP and price are required to analyze it. */
export type Property = {
  id: string;
  zip: string;
  price: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  address?: string;
  notes?: string;
  mode: Mode;
  savedAt: string;
  /** The visitor's own rent, resale value and assumptions (always including the rate used), so a
   * reopened property adds up the same. */
  rent?: number;
  resale?: number;
  assumptions?: Partial<Assumptions>;
};

/** Property inputs as read from a share link; anything invalid is simply absent. */
export type PropertyInputs = Partial<
  Omit<Property, "id" | "savedAt" | "mode" | "rent" | "resale" | "assumptions">
> & { mode: Mode };

const KEY = "houselens.properties.v1";
const MODES: Mode[] = ["live", "rental", "flip"];
const isZip = (s: unknown): s is string => typeof s === "string" && /^\d{5}$/.test(s);
const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

function valid(x: unknown): x is Property {
  const p = x as Property;
  return (
    !!p &&
    typeof p.id === "string" &&
    isZip(p.zip) &&
    positive(p.price) &&
    MODES.includes(p.mode) &&
    typeof p.savedAt === "string"
  );
}

/**
 * Reads saved properties from this browser.
 * @returns the valid saved properties; empty when storage is blocked or unreadable
 */
export function loadSaved(): Property[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(valid) : [];
  } catch {
    return [];
  }
}

/**
 * Writes saved properties to this browser.
 * @param list - properties to keep
 * @returns false when the browser blocks storage (private mode, blocked site data)
 */
export function saveSaved(list: Property[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes a backup file's text.
 * @param list - properties to back up
 * @returns JSON text
 */
export function exportSaved(list: Property[]): string {
  return JSON.stringify({ houselens: "properties", version: 1, properties: list }, null, 2);
}

/**
 * Reads a backup and merges it into the current list (current entries win on the same id).
 * @param text - backup file text
 * @param current - properties already saved
 * @returns the merged list
 */
export function importSaved(text: string, current: Property[]): Property[] {
  let data: { houselens?: string; properties?: unknown };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not a HouseLens backup.");
  }
  if (data?.houselens !== "properties" || !Array.isArray(data.properties)) {
    throw new Error("This file is not a HouseLens backup.");
  }
  const have = new Set(current.map((p) => p.id));
  return [...current, ...data.properties.filter(valid).filter((p) => !have.has(p.id))];
}

/**
 * Encodes property inputs for a share link (no leading "?").
 * @param p - the inputs
 * @param includeAddress - true only when the visitor chose to share the address
 * @returns the query string
 */
export function serializeProperty(p: PropertyInputs, includeAddress: boolean): string {
  const q = new URLSearchParams();
  if (p.zip) q.set("z", p.zip);
  if (p.price) q.set("p", String(p.price));
  if (p.beds !== undefined) q.set("bd", String(p.beds));
  if (p.baths !== undefined) q.set("ba", String(p.baths));
  if (p.sqft) q.set("sf", String(p.sqft));
  if (p.mode !== "live") q.set("m", p.mode);
  if (includeAddress && p.address) q.set("a", p.address);
  return q.toString();
}

/**
 * Reads property inputs from a share link, dropping anything invalid.
 * @param q - the page's search params
 * @returns the valid inputs
 */
export function parsePropertyParams(q: URLSearchParams): PropertyInputs {
  const out: PropertyInputs = { mode: "live" };
  const n = (k: string) => (q.has(k) ? Number(q.get(k)) : NaN);
  const z = q.get("z");
  if (isZip(z)) out.zip = z;
  if (positive(n("p"))) out.price = n("p");
  if (Number.isInteger(n("bd")) && n("bd") >= 0 && n("bd") <= 20) out.beds = n("bd");
  if (positive(n("ba")) && n("ba") <= 20) out.baths = n("ba");
  if (positive(n("sf"))) out.sqft = n("sf");
  const m = q.get("m");
  if (MODES.includes(m as Mode)) out.mode = m as Mode;
  const a = q.get("a");
  if (a) out.address = a.slice(0, 200);
  return out;
}

/**
 * The visitor's own figures from a saved property, as form text; anything invalid is dropped.
 * Saved entries can come from an imported file, so nothing here is trusted.
 * @param p - a saved property
 * @returns rent and resale text ("" when unset) and the assumption edits
 */
export function ownFigures(p: Property) {
  const text = (n: unknown) => (positive(n) ? String(n) : "");
  const edits: Partial<Record<keyof Assumptions, string>> = {};
  if (p.assumptions && typeof p.assumptions === "object") {
    for (const [k, v] of Object.entries(p.assumptions)) {
      if (Object.hasOwn(DEFAULTS, k) && typeof v === "number" && Number.isFinite(v) && v >= 0) {
        edits[k as keyof Assumptions] = String(v);
      }
    }
  }
  return { rent: text(p.rent), resale: text(p.resale), edits };
}
