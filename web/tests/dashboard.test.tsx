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
    <QueryClientProvider client={new QueryClient()}>
      <Home />
    </QueryClientProvider>,
  );
};

describe("dashboard", () => {
  it("shows own cards plus a national strip with PMMS", async () => {
    show("geo=CBSA:12420");
    const strip = await screen.findByRole("region", { name: "National context (US)" });
    expect(within(strip).getByText(/30-year fixed mortgage rate/)).toBeInTheDocument();
    expect(screen.getAllByText(/Zillow Research Data/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/FHFA House Price Index/).length).toBeGreaterThan(0);
  });

  it("shows no strip for US", async () => {
    show("geo=US");
    await screen.findAllByRole("heading", { level: 3 });
    expect(screen.queryByText("National context (US)")).toBeNull();
  });

  it("falls back to US with a warning for an unknown geo", async () => {
    show("geo=CBSA:99999");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Unknown geography/);
    expect(screen.queryByText("National context (US)")).toBeNull();
  });
});
