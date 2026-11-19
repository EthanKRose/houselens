const STATES = [
  "Alaska",
  "Idaho",
  "Kansas",
  "Louisiana",
  "Mississippi",
  "Missouri",
  "Montana",
  "New Mexico",
  "North Dakota",
  "Texas",
  "Utah",
  "Wyoming",
];

/**
 * About page: static methodology and data-gap notes.
 * @returns the page
 */
export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">About</h1>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Why the numbers disagree</h2>
        <p>HouseLens never blends sources. Indices differ because their methods differ:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            Repeat-sales (Case-Shiller, FHFA) track the same home&apos;s successive sales, control
            for quality, exclude new construction and are revised as new pairs arrive.
          </li>
          <li>
            Medians (NAR, Census new-home sales, Redfin) are timely but swing with the mix of homes
            sold.
          </li>
          <li>
            Hedonic/AVM indices (Zillow ZHVI) cover all homes but inherit model error, worse in
            non-disclosure states.
          </li>
          <li>
            Surveys (CPI shelter, ACS) are designed samples, but slow and vulnerable to funding
            lapses.
          </li>
        </ul>
        <p>
          FHFA &ldquo;employs a modified version of the Case-Shiller® index methodology, using a
          geometric weighted repeat-sales procedure.&rdquo; FHFA uses conforming, conventional
          Fannie Mae/Freddie Mac loans and includes refinance appraisals; Case-Shiller uses purchase
          prices, including jumbo and cash sales, and is value-weighted, so expensive homes move it
          more. Some sources default to seasonally adjusted figures (ZHVI, Redfin) while others
          publish NSA medians (NAR); mixing them creates false divergence.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Non-disclosure states</h2>
        <p>
          In non-disclosure states the recorded deed transfers ownership without stating the price,
          so prices come mainly from MLSs (licensed) or voluntary reporting. Consensus list:{" "}
          {STATES.join(", ")}.
        </p>
        <p>
          Missouri is partial: St. Louis city, St. Louis County and Jackson County publish prices.
          Washington and Arizona are not non-disclosure states despite some vendor lists: both
          states&apos; deed affidavits state the price.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">2025–2026 federal data disruptions</h2>
        <p>
          The federal shutdown ran Oct. 1–Nov. 12, 2025 (43 days). BLS issued no October 2025 CPI
          release. For rents, BLS stated: &ldquo;Rents for October 2025 were carried forward from
          April 2025, yielding unchanged index values for rent and owners&apos; equivalent rent for
          October.&rdquo; A secondary summary says the alternatives imply shelter inflation was
          understated by roughly 0.3–0.6 points year over year.
        </p>
        <p>
          BLS also suspended CPI data collection: &ldquo;In April, BLS suspended CPI data collection
          entirely in Lincoln, NE and Provo, UT. In June, BLS suspended collection entirely in
          Buffalo, NY. Roughly 15 percent of the sample in the other 72 areas also was suspended
          from collection, on average.&rdquo;
        </p>
      </section>
    </main>
  );
}
