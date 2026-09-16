import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.USDA_API_KEY = "test-usda-key"; // non-empty so lookups aren't disabled

let usda: typeof import("../src/usda.js");

before(async () => {
  usda = await import("../src/usda.js");
});

function stubFetch(body: unknown, ok = true) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status: ok ? 200 : 500 })) as typeof fetch;
}

describe("USDA client (2026-09-17)", () => {
  it("parses per-100g nutrients from a qualifying result", async () => {
    stubFetch({
      foods: [
        {
          fdcId: 171077,
          description: "Chicken, broilers or fryers, breast, meat only, cooked, roasted",
          dataType: "SR Legacy",
          foodNutrients: [
            { nutrientId: 1008, nutrientName: "Energy", unitName: "KCAL", value: 165 },
            { nutrientId: 1003, value: 31 },
            { nutrientId: 1005, value: 0 },
            { nutrientId: 1004, value: 3.6 },
          ],
        },
      ],
    });
    const r = await usda.lookupUsda("chicken breast", "cooked");
    assert.ok(r);
    assert.equal(r!.perBasis.calories, 165);
    assert.equal(r!.perBasis.protein_g, 31);
    assert.equal(r!.fdcId, "171077");
    assert.equal(r!.confidence, "medium");
  });

  it("rejects a processed form and picks the right whole food (dried banana vs raw)", async () => {
    stubFetch({
      foods: [
        {
          fdcId: 1,
          description: "Bananas, dehydrated, or banana powder",
          dataType: "SR Legacy",
          foodNutrients: [{ nutrientId: 1008, unitName: "KCAL", value: 346 }],
        },
        {
          fdcId: 2,
          description: "Bananas, raw",
          dataType: "SR Legacy",
          foodNutrients: [
            { nutrientId: 1008, unitName: "KCAL", value: 89 },
            { nutrientId: 1003, value: 1.1 },
          ],
        },
      ],
    });
    const r = await usda.lookupUsda("banana", "raw");
    assert.ok(r);
    assert.equal(r!.perBasis.calories, 89, "raw banana, not the 346 dried");
    assert.equal(r!.fdcId, "2");
  });

  it("returns null when nothing matches the query words", async () => {
    stubFetch({
      foods: [
        { fdcId: 9, description: "something unrelated", dataType: "SR Legacy", foodNutrients: [{ nutrientId: 1008, unitName: "KCAL", value: 100 }] },
      ],
    });
    assert.equal(await usda.lookupUsda("chicken breast", "cooked"), null);
  });

  it("returns null on an empty result set", async () => {
    stubFetch({ foods: [] });
    assert.equal(await usda.lookupUsda("nothing", "n/a"), null);
  });

  it("returns null on a network/HTTP failure rather than throwing", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    assert.equal(await usda.lookupUsda("anything", "n/a"), null);
  });
});
