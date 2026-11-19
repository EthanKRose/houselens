# Data source licenses

Only the sources below may be used. Each displayed series must be attributed
to its source on every page that shows it.

## FRED (Federal Reserve Bank of St. Louis)

Mostly public domain; some series are copyrighted by their owner (e.g., Case-Shiller). Attribute.
Series from S&P Case-Shiller are attributed to S&P Dow Jones Indices (data: Cotality).

TODO: confirm wording in Task 9b.

## FHFA HPI (Federal Housing Finance Agency)

Public domain.

TODO: confirm wording in Task 9b.

## Zillow Research

Free for public use with clear attribution. Never use Zillow or Bridge APIs to build a
stored database. Zillow's legacy public API was retired in 2021; the public research CSVs are
the sanctioned route. Scraping Zillow pages is prohibited.

TODO: confirm wording in Task 9b.

## Realtor.com Research

Public research CSVs (`RDC_Inventory_Core_Metrics_*`). Values are asking/listing data, not sales.

Realtor.com's research data page (realtor.com/research/data, read 2026-11-18) asks: "Please
attribute to Realtor.com ® Economic Research (or shortened to Realtor.com ® in cases where
space is limited) when quoting members of our team and/or using our housing data, research,
and insights". HouseLens displays "Data: Realtor.com ® Economic Research." and never scrapes
realtor.com pages.

## Redfin Data Center: DISABLED (manual drop only)

- Status: feature-flagged off (`enabled: false` in `catalog.yaml`).
- Redfin's site terms (§2.3.5) forbid automated querying "unless you have received prior express
  written permission." The Data Center states no data license.
- The pipeline never fetches redfin.com. The owner downloads files by hand and uploads them to R2
  `inputs/redfin/`.
- Do not display Redfin values publicly, and do not redistribute raw files, until written
  permission is obtained from economics@rocket.com (owner action).
