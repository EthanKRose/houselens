import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SeriesInfo } from "@/components/SeriesInfo";
import type { SeriesMeta } from "@/lib/types";

const series = {
  series_id: "fred.cs.national.sa",
  name: "Case-Shiller home prices, national (seasonally adjusted)",
  summary: "A national home price index from S&P.",
} as SeriesMeta;

it("opens a plain-language description from a labelled button, and closes on Escape", async () => {
  render(<SeriesInfo series={series} />);
  const button = screen.getByRole("button", { name: `What is ${series.name}?` });
  expect(screen.queryByText(series.summary)).not.toBeInTheDocument();
  fireEvent.click(button);
  const dialog = await screen.findByRole("dialog", { name: series.name });
  expect(dialog).toHaveTextContent(series.summary);
  fireEvent.keyDown(dialog, { key: "Escape" });
  await expect.poll(() => screen.queryByText(series.summary)).toBeNull();
});
