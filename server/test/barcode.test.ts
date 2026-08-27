import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import { validateBarcodeEntry } from "../src/validation.js";
import { totalFromBasis } from "../src/foods.js";

let lookupBarcode: typeof import("../src/openfoodfacts.js").lookupBarcode;

before(async () => {
  ({ lookupBarcode } = await import("../src/openfoodfacts.js"));
});

const realFetch = globalThis.fetch;

function stubFetch(body: unknown, ok = true) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status: ok ? 200 : 404 })) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("lookupBarcode", () => {
  it("maps a found product to per-100g nutrition", async () => {
    stubFetch({
      status: 1,
      product: {
        product_name: "Butter Crackers",
        brands: "Acme, Some Other Brand",
        nutriments: { "energy-kcal_100g": 480, proteins_100g: 7, carbohydrates_100g: 60, fat_100g: 22 },
      },
    });
    const product = await lookupBarcode("00000001");
    assert.ok(product);
    assert.equal(product.name, "Butter Crackers");
    assert.equal(product.brand, "Acme");
    assert.deepEqual(product.nutrition, { calories: 480, protein_g: 7, carbs_g: 60, fat_g: 22 });
  });

  it("returns null for an unknown barcode (status 0)", async () => {
    stubFetch({ status: 0 });
    assert.equal(await lookupBarcode("00000002"), null);
  });

  it("returns null for a product with no calorie figure", async () => {
    stubFetch({ status: 1, product: { product_name: "Mystery Item", nutriments: {} } });
    assert.equal(await lookupBarcode("00000003"), null);
  });

  it("returns null on a network/HTTP failure rather than throwing", async () => {
    stubFetch({}, false);
    assert.equal(await lookupBarcode("00000004"), null);
  });
});

describe("barcode grams math", () => {
  it("scales a per-100g product to the grams eaten", () => {
    const per100g = { calories: 42, protein_g: 0, carbs_g: 10.6, fat_g: 0 };
    const total = totalFromBasis(per100g, "per_100g", 250);
    assert.equal(total.calories, 105);
    assert.equal(total.carbs_g, 26.5);
  });
});

describe("validateBarcodeEntry", () => {
  it("accepts a valid body", () => {
    assert.equal(validateBarcodeEntry({ barcode: "5901234123457", grams: 250 }), null);
  });

  it("rejects a non-digit or wrong-length barcode", () => {
    assert.ok(validateBarcodeEntry({ barcode: "abc", grams: 100 }));
    assert.ok(validateBarcodeEntry({ barcode: "123", grams: 100 }));
    assert.ok(validateBarcodeEntry({ barcode: "1".repeat(15), grams: 100 }));
  });

  it("rejects grams out of range", () => {
    assert.ok(validateBarcodeEntry({ barcode: "12345678", grams: 0 }));
    assert.ok(validateBarcodeEntry({ barcode: "12345678", grams: 5001 }));
    assert.ok(validateBarcodeEntry({ barcode: "12345678", grams: Number.NaN }));
  });
});
