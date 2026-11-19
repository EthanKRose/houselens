import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttributionFooter } from "@/components/AttributionFooter";
import type { Catalog } from "@/lib/types";

const src = (id: string, attribution: string) => ({
  source_id: id,
  name: id,
  publisher: "p",
  homepage_url: "https://example.com",
  license_note: "l",
  attribution,
});

describe("AttributionFooter", () => {
  it("renders every source attribution and a sources link", () => {
    const catalog: Catalog = {
      sources: [src("a", "Data from Alpha"), src("b", "Data from Beta")],
      metrics: [],
      series: [],
      known_events: {},
    };
    render(<AttributionFooter catalog={catalog} />);
    expect(screen.getByText("Data from Alpha")).toBeTruthy();
    expect(screen.getByText("Data from Beta")).toBeTruthy();
    expect(screen.getByRole("link", { name: /sources/i }).getAttribute("href")).toBe("/sources");
  });
});
