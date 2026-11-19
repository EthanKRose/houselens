import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("@/components/Sparkline", () => ({ Sparkline: () => null }));

import Home from "@/app/page";

beforeEach(() => {
  vi.stubGlobal("fetch", async (path: string) => ({
    ok: true,
    json: async () => JSON.parse(readFileSync(`public${path}`, "utf8")),
  }));
});

const show = (q: string) => {
  search = q;
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Home />
    </QueryClientProvider>,
  );
};

describe("dashboard", () => {
  it("separates own cards from the national strip for CBSA:12420", async () => {
    show("geo=CBSA:12420");
    const strip = await screen.findByRole("region", { name: "National context (US)" });
    const ownSec = screen.getByRole("region", { name: /Austin/ });
    expect(within(strip).getByText(/30-year fixed mortgage rate/)).toBeInTheDocument();
    expect(within(ownSec).queryByText(/30-year fixed mortgage rate/)).toBeNull();
    expect(within(ownSec).getAllByText(/Zillow Research Data/).length).toBeGreaterThan(0);
    expect(within(ownSec).getAllByText(/FHFA House Price Index/).length).toBeGreaterThan(0);
  });

  it("renders US cards including PMMS and no strip for US", async () => {
    show("geo=US");
    expect(await screen.findByText(/30-year fixed mortgage rate/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "National context (US)" })).toBeNull();
  });

  it("falls back to US cards with a warning for an unknown geo", async () => {
    show("geo=CBSA:99999");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Unknown geography/);
    expect(await screen.findByText(/30-year fixed mortgage rate/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "National context (US)" })).toBeNull();
  });

  it("shows an error when data fails to load", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500 }));
    show("geo=US");
    expect(await screen.findByRole("alert")).toHaveTextContent(/load/i);
  });
});
