import { describe, expect, it } from 'vitest';
import { parseCuratedCache } from './seed-curated-foods.js';

const SAMPLE = `
## Protein Sources

| Food | Serving | Cal | Protein | Carbs | Fat |
|------|---------|----:|--------:|------:|----:|
| Chicken Breast (raw) | 100g raw | 120 | 23g | 0g | 2.6g |
| Boiled Egg (whole) | 1 egg (~50g) | 68 | 6g | 0.6g | 4.8g |
| Paneer | 100g | 265 | 18g | 3.4g | 20g |

## Supplements

| Food | Serving | Cal | Protein | Carbs | Fat |
|------|---------|----:|--------:|------:|----:|
| Avvatar Performance Whey | 1 scoop (33g) in water | 118 | 25g | 2.7g | 1.4g |
| Diet Coke | 1 can (330ml) | 1 | 0g | 0g | 0g |
`;

describe('parseCuratedCache', () => {
  it('reads every data row and skips headers and separators', () => {
    const foods = parseCuratedCache(SAMPLE);
    expect(foods).toHaveLength(5);
    expect(foods.map((f) => f.name)).not.toContain('Food');
  });

  it('parses macros with unit suffixes stripped', () => {
    const paneer = parseCuratedCache(SAMPLE).find((f) => f.name === 'Paneer')!;
    expect(paneer.calories).toBe(265);
    expect(paneer.protein).toBe(18);
    expect(paneer.carbs).toBe(3.4);
    expect(paneer.fat).toBe(20);
  });

  it('derives a gram quantity from the serving column', () => {
    const chicken = parseCuratedCache(SAMPLE).find((f) => f.name.includes('Chicken'))!;
    expect(chicken.unit).toBe('g');
    expect(chicken.quantity).toBe(100);
  });

  it('prefers the weight over a leading count for "1 egg (~50g)"', () => {
    const egg = parseCuratedCache(SAMPLE).find((f) => f.name.includes('Boiled Egg'))!;
    // 68 kcal / 50 g must come out per-gram, not per-egg, or scaling breaks.
    expect(egg.unit).toBe('g');
    expect(egg.quantity).toBe(50);
  });

  it('reads scoops and cans', () => {
    const foods = parseCuratedCache(SAMPLE);
    const whey = foods.find((f) => f.name.includes('Avvatar'))!;
    const coke = foods.find((f) => f.name === 'Diet Coke')!;

    expect(whey.unit).toBe('scoop');
    expect(whey.quantity).toBe(1);
    expect(coke.unit).toBe('can');
    expect(coke.quantity).toBe(1);
  });

  it('ignores prose lines that are not table rows', () => {
    expect(parseCuratedCache('Some notes about food.\n\nMore prose.')).toEqual([]);
  });
});
