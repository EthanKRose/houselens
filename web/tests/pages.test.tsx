import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AboutPage from "@/app/about/page";
import SourcesPage from "@/app/sources/page";
import { SiteHeader } from "@/components/SiteHeader";

const catalog = JSON.parse(readFileSync("public/data/catalog.json", "utf8"));

beforeEach(() => {
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => catalog }));
});

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

describe("SourcesPage", () => {
  it("renders every source's license note, attribution and series details", async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SourcesPage />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getAllByRole("heading", { level: 2 }).length).toBe(catalog.sources.length),
    );
    for (const s of catalog.sources) {
      expect(screen.getAllByText(s.license_note).length).toBeGreaterThan(0);
      expect(screen.getAllByText(s.attribution).length).toBeGreaterThan(0);
      expect(screen.getAllByText(new RegExp(s.publisher)).length).toBeGreaterThan(0);
    }
    expect(
      screen.getAllByText(/published release date|first seen by HouseLens/).length,
    ).toBeGreaterThan(0);
  });
});

describe("AboutPage", () => {
  it("names all 12 non-disclosure states and the Missouri note", () => {
    render(<AboutPage />);
    for (const n of STATES) expect(screen.getAllByText(new RegExp(n)).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/St\. Louis city, St\. Louis County and Jackson County/),
    ).toBeInTheDocument();
  });
});

describe("SiteHeader", () => {
  it("links to the five pages", () => {
    render(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav.querySelectorAll("a")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "Analyze a property" })).toHaveAttribute(
      "href",
      "/property",
    );
    expect(screen.getByRole("link", { name: "Sources" })).toHaveAttribute("href", "/sources");
    expect(screen.getByRole("link", { name: "HouseLens" })).toHaveAttribute("href", "/");
  });
});
