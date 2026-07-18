import { describe, expect, it } from 'vitest';
import { normalizeFoodName, parseQuantity, scaleMacros } from './food-normalize.js';

describe('normalizeFoodName', () => {
  it('collapses whey variants that differ only by casing, quantity or noise words', () => {
    const keys = new Set(
      [
        'Avvatar Whey Protein (1 scoop)',
        'Avvatar Whey Protein (1 scoop, 35g)',
        'Avvatar whey protein',
      ].map(normalizeFoodName)
    );

    expect(keys.size).toBe(1);
  });

  it('does NOT merge names with genuinely different words', () => {
    // "Avvatar Whey" vs "Avvatar Whey Protein Shake" are different token sets.
    // Merging these is the alias layer's job, not normalisation's — keeping
    // that boundary means normalisation never silently merges two real foods.
    expect(normalizeFoodName('Avvatar Whey (1 scoop)')).not.toBe(
      normalizeFoodName('Avvatar Whey Protein Shake (1 scoop)')
    );
  });

  it('collapses muesli variants that differ only by casing and milk volume', () => {
    const keys = new Set(
      [
        'MuscleBlaze HP Muesli (50g) + milk (100ml)',
        'MuscleBlaze HP Muesli (50g) + Milk (100ml)',
        'MuscleBlaze HP Muesli 50g + 120ml milk',
      ].map(normalizeFoodName)
    );

    expect(keys.size).toBe(1);
  });

  it('collapses rice portions onto one key', () => {
    expect(normalizeFoodName('Cooked White Rice (150g)')).toBe(
      normalizeFoodName('White Rice (180g cooked)')
    );
  });

  it('keeps genuinely different foods apart', () => {
    expect(normalizeFoodName('Chapati (2)')).not.toBe(normalizeFoodName('Cooked Rice (160g)'));
    expect(normalizeFoodName('Paneer (100g)')).not.toBe(normalizeFoodName('Boiled Eggs (3)'));
  });

  it('is insensitive to word order', () => {
    expect(normalizeFoodName('Rice cooked (200g)')).toBe(normalizeFoodName('Cooked Rice (200g)'));
  });
});

describe('parseQuantity', () => {
  it('reads weight in grams', () => {
    expect(parseQuantity('Cooked Rice (160g)')).toEqual({ quantity: 160, unit: 'g' });
  });

  it('reads scoops', () => {
    expect(parseQuantity('Avvatar Isorich Shake (1 scoop)')).toEqual({
      quantity: 1,
      unit: 'scoop',
    });
  });

  it('reads millilitres', () => {
    expect(parseQuantity('Toned Milk (100ml)')).toEqual({ quantity: 100, unit: 'ml' });
  });

  it('reads a bare count as pieces', () => {
    expect(parseQuantity('Chapati (2)')).toEqual({ quantity: 2, unit: 'piece' });
    expect(parseQuantity('Boiled eggs x3')).toEqual({ quantity: 3, unit: 'piece' });
  });

  it('returns null when there is no quantity', () => {
    expect(parseQuantity('Black coffee')).toBeNull();
  });

  it('ignores rupee amounts as quantities', () => {
    expect(parseQuantity('RiteBite Max Protein bar (₹80, 10g protein)')?.unit).not.toBe('piece');
  });
});

describe('scaleMacros', () => {
  it('scales per-gram macros to a portion', () => {
    const rice = {
      calories_per_unit: 1.3,
      protein_g_per_unit: 0.027,
      carbs_g_per_unit: 0.28,
      fat_g_per_unit: 0.003,
    };

    expect(scaleMacros(rice, 150)).toEqual({
      calories: 195,
      protein_g: 4.1,
      carbs_g: 42,
      fat_g: 0.5,
    });
  });

  it('preserves nulls for untracked macros', () => {
    const result = scaleMacros(
      { calories_per_unit: 5, protein_g_per_unit: null, carbs_g_per_unit: null, fat_g_per_unit: null },
      1
    );

    expect(result).toEqual({ calories: 5, protein_g: null, carbs_g: null, fat_g: null });
  });
});

describe('parseQuantity — leading counts', () => {
  it('reads a leading bare count', () => {
    expect(parseQuantity('2 chapatis')).toEqual({ quantity: 2, unit: 'piece' });
    expect(parseQuantity('3 Boiled Eggs')).toEqual({ quantity: 3, unit: 'piece' });
  });

  it('still prefers an explicit weight over a leading count', () => {
    expect(parseQuantity('2 rotis (100g)')).toEqual({ quantity: 100, unit: 'g' });
  });
});
