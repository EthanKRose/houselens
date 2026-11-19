import Link from "next/link";
import type { Catalog } from "@/lib/types";

/**
 * Footer listing every enabled source's attribution.
 * @param props - component props
 * @param props.catalog - the loaded catalog
 * @returns the footer element
 */
export function AttributionFooter({ catalog }: { catalog: Catalog }) {
  return (
    <footer className="mt-8 border-t p-4 text-xs text-muted-foreground">
      <ul className="space-y-1">
        {catalog.sources.map((s) => (
          <li key={s.source_id}>{s.attribution}</li>
        ))}
      </ul>
      <Link href="/sources" className="underline">
        Sources &amp; methodology
      </Link>
    </footer>
  );
}
