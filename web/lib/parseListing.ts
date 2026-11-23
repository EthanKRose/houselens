/** Reads price, beds, baths, square feet and ZIP from listing text a visitor pasted. Nothing is fetched. */

/** Fields found in pasted text; missing ones are left out. */
export type ParsedListing = {
  price?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  zip?: string;
};

const num = (s: string) => Number(s.replace(/,/g, ""));

/**
 * Pulls listing facts out of copied text.
 * @param text - text the visitor copied from a listing
 * @returns the fields it could find
 */
export function parseListing(text: string): ParsedListing {
  const out: ParsedListing = {};
  // The first dollar amount of $10,000+ is the price; smaller ones are fees or payments.
  for (const m of text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*([km])?\b/gi)) {
    const scale = { k: 1e3, m: 1e6 }[m[2]?.toLowerCase() as "k" | "m"] ?? 1;
    const value = num(m[1]) * scale;
    if (value >= 10_000) {
      out.price = Math.round(value);
      break;
    }
  }
  const beds = text.match(/(\d+(?:\.\d+)?)\s*(?:bds?|beds?|bedrooms?)\b/i);
  if (beds) out.beds = num(beds[1]);
  const baths = text.match(/(\d+(?:\.\d+)?)\s*(?:ba|baths?|bathrooms?)\b/i);
  if (baths) out.baths = num(baths[1]);
  const sqft = text.match(/(\d[\d,]*)\s*(?:sq\.?\s*ft\.?|sqft|square\s+feet)/i);
  if (sqft) out.sqft = num(sqft[1]);
  // A ZIP follows a two-letter state ("TX 78704"); ZIP+4 is trimmed.
  const zip = text.match(/\b[A-Z]{2}\s+(\d{5})(?:-\d{4})?\b/);
  if (zip) out.zip = zip[1];
  return out;
}
