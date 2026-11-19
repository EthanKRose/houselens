"use client";

import { AttributionFooter } from "@/components/AttributionFooter";
import { useCatalog } from "@/lib/data";

/**
 * Loads the catalog client-side and renders the attribution footer.
 * @returns the footer, or nothing until the catalog loads
 */
export function SiteFooter() {
  const { data } = useCatalog();
  return data ? <AttributionFooter catalog={data} /> : null;
}
