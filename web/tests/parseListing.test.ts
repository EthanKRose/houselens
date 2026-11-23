import { describe, expect, it } from "vitest";
import { parseListing } from "@/lib/parseListing";

describe("parseListing", () => {
  it("reads a typical copied listing summary", () => {
    const text = `$549,900
3 bd | 2 ba | 1,850 sqft
1234 S Congress Ave, Austin, TX 78704
Est. payment: $3,512/mo`;
    expect(parseListing(text)).toEqual({
      price: 549900,
      beds: 3,
      baths: 2,
      sqft: 1850,
      zip: "78704",
    });
  });

  it("understands spelled-out words, half baths and ZIP+4", () => {
    const text =
      "Price: $1.2M · 4 Bedrooms · 2.5 Bathrooms · 2,400 square feet · Denver, CO 80202-1234";
    expect(parseListing(text)).toEqual({
      price: 1_200_000,
      beds: 4,
      baths: 2.5,
      sqft: 2400,
      zip: "80202",
    });
  });

  it("ignores small dollar amounts like monthly payments and HOA fees", () => {
    expect(parseListing("HOA $250/mo, list price $415K")).toMatchObject({ price: 415000 });
  });

  it("returns only what it finds", () => {
    expect(parseListing("nice yard")).toEqual({});
    expect(parseListing("Studio, 600 sq. ft.")).toEqual({ sqft: 600 });
  });
});
