import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, expect, it, vi } from "vitest";
import { GeoPicker } from "@/components/GeoPicker";
import type { Geography } from "@/lib/types";

beforeAll(() => {
  // cmdk needs these browser APIs, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

const geo = (geo_id: string, name: string) => ({ geo_id, name }) as Geography;
const geos = [geo("US", "United States"), geo("CBSA:19740", "Denver-Aurora-Centennial, CO")];

it("is fully usable from the keyboard and never drops focus", () => {
  const onChange = vi.fn();
  render(<GeoPicker geographies={geos} value="US" onChange={onChange} />);
  const button = screen.getByRole("button", { name: /United States/ });

  fireEvent.click(button);
  const search = screen.getByPlaceholderText(/Search by name/);
  expect(search).toHaveFocus();

  fireEvent.keyDown(search, { key: "Escape" });
  expect(screen.queryByPlaceholderText(/Search by name/)).toBeNull();
  expect(button).toHaveFocus();

  fireEvent.click(button);
  fireEvent.click(screen.getByText("Denver-Aurora-Centennial, CO"));
  expect(onChange).toHaveBeenCalledWith("CBSA:19740");
  expect(screen.queryByPlaceholderText(/Search by name/)).toBeNull();
  expect(button).toHaveFocus();
});
