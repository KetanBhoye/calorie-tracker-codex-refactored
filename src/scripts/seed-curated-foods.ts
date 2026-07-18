/**
 * Seeds the food library from the hand-curated macros cache.
 *
 * The library derived from logging history uses medians of whatever was
 * logged, which sometimes bakes in an estimate. The cache in
 * .github/instructions/food-macros-cache.md holds label/USDA-verified values,
 * so where the two describe the same food the curated numbers win and the food
 * is marked verified.
 *
 *   pnpm food:seed -- --db ./data/calorie-tracker.db          (dry run)
 *   pnpm food:seed -- --db ./data/calorie-tracker.db --apply
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { normalizeFoodName, parseQuantity } from '../utils/food-normalize.js';

interface CuratedFood {
  name: string;
  serving: string;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  unit: string;
  quantity: number;
}

function parseNumber(cell: string): number | null {
  const cleaned = cell.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Reads the markdown tables. Every table in the cache uses the same shape:
 * | Food | Serving | Cal | Protein | Carbs | Fat |
 */
export function parseCuratedCache(markdown: string): CuratedFood[] {
  const foods: CuratedFood[] = [];

  for (const line of markdown.split('\n')) {
    if (!line.trim().startsWith('|')) continue;

    const cells = line.split('|').map((cell) => cell.trim());
    // Leading and trailing empties from the outer pipes.
    if (cells.length < 8) continue;

    const [, name, serving, cal, protein, carbs, fat] = cells;
    if (!name || !serving || !cal) continue;
    if (/^-+$/.test(name) || name.toLowerCase() === 'food') continue;

    const calories = parseNumber(cal);
    if (calories === null) continue;

    // The serving column carries the quantity ("165g raw", "1 scoop (33g)").
    const parsed = parseQuantity(serving);

    foods.push({
      name,
      serving,
      calories,
      protein: parseNumber(protein ?? ''),
      carbs: parseNumber(carbs ?? ''),
      fat: parseNumber(fat ?? ''),
      unit: parsed?.unit ?? 'serving',
      quantity: parsed?.quantity ?? 1,
    });
  }

  return foods;
}

function main(): void {
  const args = process.argv.slice(2);
  const dbPath = args[args.indexOf('--db') + 1];
  const apply = args.includes('--apply');
  const cachePath = '.github/instructions/food-macros-cache.md';

  if (!dbPath || dbPath.startsWith('--')) {
    console.error('Usage: seed-curated-foods --db <path> [--apply]');
    process.exit(1);
  }

  const curated = parseCuratedCache(readFileSync(cachePath, 'utf8'));
  console.log(`parsed ${curated.length} curated foods from ${cachePath}`);

  const db = new Database(dbPath, { readonly: !apply });
  const userId =
    (db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: string })?.id ??
    'admin';

  const findFood = db.prepare(
    'SELECT id, canonical_name, calories_per_unit, reference_unit FROM foods WHERE user_id = ? AND normalized_key = ?'
  );

  const updates: Array<{ name: string; from: number; to: number }> = [];
  const inserts: CuratedFood[] = [];
  const skipped: string[] = [];
  const unitConflicts: Array<{ name: string; historyUnit: string; curatedUnit: string }> = [];

  for (const food of curated) {
    // Several rows describe the same food at different portion sizes; they all
    // normalise to one key and produce the same per-unit values, so the first
    // one wins and the rest are redundant.
    const key = normalizeFoodName(food.name);
    if (!key) {
      skipped.push(food.name);
      continue;
    }

    const perUnitCalories = food.calories / food.quantity;
    const existing = findFood.get(userId, key) as
      | { id: string; canonical_name: string; calories_per_unit: number; reference_unit: string }
      | undefined;

    if (existing) {
      // The two sources must agree on the unit before their numbers can be
      // compared, let alone overwritten. The history may hold a food per piece
      // ("1 boiled egg white" = 17 kcal) while the cache expresses it per gram
      // (0.567 kcal/g) — same food, and blindly copying the curated figure
      // would under-report that food by ~30x on every future entry.
      if (existing.reference_unit !== food.unit) {
        unitConflicts.push({
          name: existing.canonical_name,
          historyUnit: existing.reference_unit,
          curatedUnit: food.unit,
        });
        continue;
      }

      updates.push({
        name: existing.canonical_name,
        from: existing.calories_per_unit,
        to: perUnitCalories,
      });
    } else {
      inserts.push(food);
    }
  }

  console.log(`matched existing foods (will verify): ${updates.length}`);
  console.log(`new foods to add                    : ${inserts.length}`);
  console.log(`skipped (unparseable name)          : ${skipped.length}`);
  console.log(`skipped (unit conflict)             : ${unitConflicts.length}`);

  if (unitConflicts.length > 0) {
    console.log('\n--- unit conflicts, left untouched (fix by hand if wanted) ---');
    for (const conflict of unitConflicts) {
      console.log(
        `${conflict.name.slice(0, 44).padEnd(46)} history=${conflict.historyUnit} curated=${conflict.curatedUnit}`
      );
    }
  }

  console.log('\n--- sample of matched foods (per-unit kcal: history -> curated) ---');
  for (const update of updates.slice(0, 12)) {
    const delta = update.from > 0 ? ((update.to - update.from) / update.from) * 100 : 0;
    console.log(
      `${update.name.slice(0, 44).padEnd(46)} ${update.from.toFixed(3)} -> ${update.to.toFixed(3)}  (${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%)`
    );
  }

  if (!apply) {
    console.log('\nDry run — no changes written. Re-run with --apply.');
    db.close();
    return;
  }

  const updateFood = db.prepare(`
    UPDATE foods SET calories_per_unit = ?, protein_g_per_unit = ?, carbs_g_per_unit = ?,
      fat_g_per_unit = ?, source = 'curated_cache', verified = 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND normalized_key = ?
  `);
  const insertFood = db.prepare(`
    INSERT INTO foods (
      id, user_id, canonical_name, normalized_key, reference_unit, reference_quantity,
      calories_per_unit, protein_g_per_unit, carbs_g_per_unit, fat_g_per_unit,
      default_quantity, source, verified
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'curated_cache', 1)
  `);

  const beforeEntries = (
    db.prepare('SELECT COUNT(*) n FROM food_entries').get() as { n: number }
  ).n;
  const beforeCalories = (
    db.prepare('SELECT COALESCE(SUM(calories),0) t FROM food_entries').get() as { t: number }
  ).t;

  const seen = new Set<string>();
  const run = db.transaction(() => {
    for (const food of curated) {
      const key = normalizeFoodName(food.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const perUnit = (value: number | null) =>
        value === null ? null : value / food.quantity;

      const existing = findFood.get(userId, key) as { reference_unit: string } | undefined;
      // Same guard as the dry-run pass: never overwrite across units.
      if (existing && existing.reference_unit !== food.unit) continue;

      if (existing) {
        updateFood.run(
          food.calories / food.quantity,
          perUnit(food.protein),
          perUnit(food.carbs),
          perUnit(food.fat),
          userId,
          key
        );
      } else {
        insertFood.run(
          crypto.randomUUID(),
          userId,
          food.name,
          key,
          food.unit,
          food.calories / food.quantity,
          perUnit(food.protein),
          perUnit(food.carbs),
          perUnit(food.fat),
          food.quantity
        );
      }
    }
  });

  run();

  const afterEntries = (
    db.prepare('SELECT COUNT(*) n FROM food_entries').get() as { n: number }
  ).n;
  const afterCalories = (
    db.prepare('SELECT COALESCE(SUM(calories),0) t FROM food_entries').get() as { t: number }
  ).t;
  const verified = (
    db.prepare('SELECT COUNT(*) n FROM foods WHERE verified = 1').get() as { n: number }
  ).n;

  console.log('\n--- validation ---');
  console.log(`entries before/after : ${beforeEntries} / ${afterEntries}`);
  console.log(`calories before/after: ${beforeCalories} / ${afterCalories}`);
  console.log(`verified foods       : ${verified}`);

  if (afterEntries !== beforeEntries || afterCalories !== beforeCalories) {
    throw new Error('Seeding must never touch logged entries.');
  }

  console.log('✓ seeding complete, logged history untouched');
  db.close();
}

// Only run when executed directly, so the module can be imported by tests.
if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  main();
}
