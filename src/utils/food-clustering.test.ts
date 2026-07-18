import { describe, expect, it } from 'vitest';
import { buildClusters, type EntryRow } from './food-clustering.js';

let seq = 0;
function entry(food_name: string, calories: number, overrides: Partial<EntryRow> = {}): EntryRow {
  seq += 1;
  return {
    id: `e${seq}`,
    user_id: 'admin',
    food_name,
    calories,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    meal_type: 'snack',
    entry_date: '2026-07-01',
    ...overrides,
  };
}

describe('buildClusters', () => {
  it('never loses an entry, whatever the merge does', () => {
    const entries = [
      entry('Avvatar Whey (1 scoop)', 118),
      entry('Avvatar Whey Protein (1 scoop, evening)', 120),
      entry('Avvatar Isorich Shake (1 scoop)', 130),
      entry('Cooked White Rice (150g)', 195),
      entry('Rice (200g cooked)', 260),
      entry('Chapati (2)', 200),
      entry('Some One-Off Restaurant Thing', 640),
    ];

    const clusters = buildClusters(entries);
    const clustered = clusters.flatMap((c) => c.entries.map((e) => e.id));

    expect(new Set(clustered).size).toBe(entries.length);
    expect(clustered.length).toBe(entries.length);
  });

  it('merges whey spellings that differ by timing, flavour and product line', () => {
    const entries = [
      entry('Avvatar Whey (1 scoop)', 118),
      entry('Avvatar Whey Protein (1 scoop, post-workout)', 118),
      entry('Avvatar Whey Protein 1 scoop (Malai Kulfi)', 130),
      entry('Avvatar Isorich Shake (1 scoop)', 130),
      entry('Avvatar Whey Shake (1 scoop + water)', 120),
    ];

    const clusters = buildClusters(entries);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.entries).toHaveLength(5);
    expect(clusters[0]!.unit).toBe('scoop');
  });

  it('does not merge foods whose per-unit calories disagree', () => {
    // Same head token, very different energy density: must stay apart.
    const entries = [
      entry('Cooked White Rice (100g)', 130),
      entry('Cooked White Rice (150g)', 195),
      entry('Rice Kheer (100g)', 400),
      entry('Rice Kheer (150g)', 600),
    ];

    const clusters = buildClusters(entries);
    const names = clusters.map((c) => c.canonicalName);

    expect(clusters.length).toBeGreaterThan(1);
    expect(names.some((n) => n.includes('Kheer'))).toBe(true);
  });

  it('does not let a cluster become a sink that swallows unrelated foods', () => {
    // Regression: an eroded/empty token core made every containment check
    // vacuously true, collapsing the whole log into one food.
    const entries = [
      entry('Chicken Breast (100g)', 165),
      entry('Broccoli (100g)', 34),
      entry('Paneer (100g)', 265),
      entry('Banana (1 medium)', 105),
      entry('Black coffee', 5),
    ];

    const clusters = buildClusters(entries);

    expect(clusters).toHaveLength(5);
  });

  it('derives per-unit macros from the median, ignoring one bad entry', () => {
    const entries = [
      entry('Cooked Rice (100g)', 130, { protein_g: 2.7, carbs_g: 28, fat_g: 0.3 }),
      entry('Cooked Rice (100g)', 130, { protein_g: 2.7, carbs_g: 28, fat_g: 0.3 }),
      entry('Cooked Rice (100g)', 130, { protein_g: 2.7, carbs_g: 28, fat_g: 0.3 }),
      // typo'd entry: one zero should not drag the library value down
      entry('Cooked Rice (100g)', 13, { protein_g: 0.27, carbs_g: 2.8, fat_g: 0.03 }),
    ];

    const [cluster] = buildClusters(entries);

    expect(cluster!.perUnit.calories).toBeCloseTo(1.3, 2);
    expect(cluster!.perUnit.protein).toBeCloseTo(0.027, 3);
  });

  it('picks the most-logged spelling as the canonical name', () => {
    const entries = [
      entry('Chapati (2)', 200),
      entry('Chapati (2)', 200),
      entry('Chapati x2', 200),
    ];

    const [cluster] = buildClusters(entries);

    expect(cluster!.canonicalName).toBe('Chapati (2)');
  });

  it('flags a cluster whose entries disagree on calories per unit', () => {
    const entries = [
      entry('Mystery Curry (100g)', 100),
      entry('Mystery Curry (100g)', 400),
    ];

    const [cluster] = buildClusters(entries);

    expect(cluster!.variancePct).toBeGreaterThan(25);
  });
});
