import { describe, expect, it } from 'vitest';
import { normalizeOpenFoodFacts, normalizeUsda } from './food-lookup.js';

describe('normalizeOpenFoodFacts', () => {
  it('converts per-100g nutriments to per-gram', () => {
    const [result] = normalizeOpenFoodFacts([
      {
        product_name: 'Greek Yogurt',
        brands: 'Epigamia, Other',
        code: '890123',
        nutriments: {
          'energy-kcal_100g': 59,
          proteins_100g: 10,
          carbohydrates_100g: 3.6,
          fat_100g: 0.4,
        },
      },
    ]);

    expect(result!.calories_per_unit).toBeCloseTo(0.59, 4);
    expect(result!.protein_g_per_unit).toBeCloseTo(0.1, 4);
    expect(result!.reference_unit).toBe('g');
    expect(result!.default_quantity).toBe(100);
    // Only the first brand is kept.
    expect(result!.brand).toBe('Epigamia');
  });

  it('skips products with no kcal value', () => {
    // OFF often has energy in kJ only; without kcal we cannot trust a
    // conversion, so the product is dropped rather than guessed at.
    expect(
      normalizeOpenFoodFacts([
        { product_name: 'Mystery Item', nutriments: { energy_100g: 1000 } },
      ])
    ).toEqual([]);
  });

  it('skips products with no name or zero calories', () => {
    expect(
      normalizeOpenFoodFacts([
        { nutriments: { 'energy-kcal_100g': 100 } },
        { product_name: 'Water', nutriments: { 'energy-kcal_100g': 0 } },
      ])
    ).toEqual([]);
  });

  it('keeps missing macros as null rather than zero', () => {
    const [result] = normalizeOpenFoodFacts([
      { product_name: 'Oil', nutriments: { 'energy-kcal_100g': 900, fat_100g: 100 } },
    ]);

    expect(result!.protein_g_per_unit).toBeNull();
    expect(result!.carbs_g_per_unit).toBeNull();
    expect(result!.fat_g_per_unit).toBeCloseTo(1, 4);
  });

  it('rejects negative or non-numeric nutriment values', () => {
    const [result] = normalizeOpenFoodFacts([
      {
        product_name: 'Bad Data',
        nutriments: { 'energy-kcal_100g': 200, proteins_100g: -5, fat_100g: 'x' },
      },
    ]);

    expect(result!.protein_g_per_unit).toBeNull();
    expect(result!.fat_g_per_unit).toBeNull();
  });
});

describe('normalizeUsda', () => {
  it('reads nutrients by name and converts to per-gram', () => {
    const [result] = normalizeUsda([
      {
        description: 'Rice, white, cooked',
        fdcId: 123456,
        foodNutrients: [
          { nutrientName: 'Energy', value: 130 },
          { nutrientName: 'Protein', value: 2.7 },
          { nutrientName: 'Carbohydrate, by difference', value: 28 },
          { nutrientName: 'Total lipid (fat)', value: 0.3 },
        ],
      },
    ]);

    expect(result!.calories_per_unit).toBeCloseTo(1.3, 4);
    expect(result!.protein_g_per_unit).toBeCloseTo(0.027, 4);
    expect(result!.carbs_g_per_unit).toBeCloseTo(0.28, 4);
    expect(result!.source).toBe('usda');
    expect(result!.source_ref).toBe('123456');
  });

  it('skips foods with no energy value', () => {
    expect(
      normalizeUsda([{ description: 'Nothing', foodNutrients: [{ nutrientName: 'Protein', value: 5 }] }])
    ).toEqual([]);
  });
});

describe('plausibility flagging', () => {
  it('flags an entry whose calories exceed what food can physically contain', () => {
    // Real case: a flaked-rice product on OFF listing 722 kcal/100g.
    const [result] = normalizeOpenFoodFacts([
      {
        product_name: 'Poha Flaked Rice',
        nutriments: { 'energy-kcal_100g': 950, proteins_100g: 12, carbohydrates_100g: 76, fat_100g: 1 },
      },
    ]);

    expect(result!.suspect).toBe(true);
  });

  it("flags an entry whose macros don't reconcile with its calories", () => {
    const [result] = normalizeOpenFoodFacts([
      {
        product_name: 'Wrong Data',
        // 12P + 76C + 1F ≈ 361 kcal, not 722.
        nutriments: { 'energy-kcal_100g': 722, proteins_100g: 12, carbohydrates_100g: 76, fat_100g: 1 },
      },
    ]);

    expect(result!.suspect).toBe(true);
  });

  it('does not flag a correct entry', () => {
    const [result] = normalizeOpenFoodFacts([
      {
        product_name: 'Amul Malai Paneer',
        nutriments: { 'energy-kcal_100g': 312, proteins_100g: 20, carbohydrates_100g: 3.4, fat_100g: 25 },
      },
    ]);

    expect(result!.suspect).toBe(false);
  });

  it('does not flag when macros are simply missing', () => {
    const [result] = normalizeOpenFoodFacts([
      { product_name: 'Partial', nutriments: { 'energy-kcal_100g': 200, proteins_100g: 5 } },
    ]);

    expect(result!.suspect).toBe(false);
  });
});
