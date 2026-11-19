import Link from "next/link";

const LINKS = [
  ["Dashboard", "/"],
  ["Compare", "/compare"],
  ["Sources", "/sources"],
  ["About", "/about"],
] as const;

/**
 * Site header with the home link and main navigation.
 * @returns the header
 */
export function SiteHeader() {
  return (
    <header className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 p-4 sm:px-8">
      <Link href="/" className="font-semibold">
        HouseLens
      </Link>
      <nav aria-label="Main" className="flex gap-4 text-sm">
        {LINKS.map(([label, href]) => (
          <Link key={href} href={href} className="underline-offset-4 hover:underline">
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
