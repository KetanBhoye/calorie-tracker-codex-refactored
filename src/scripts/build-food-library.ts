/**
 * Derives a canonical food library from existing food_entries history.
 *
 * Default mode is a dry run that writes a human-reviewable mapping file and
 * touches nothing. Pass --apply to write the library and link entries.
 *
 *   pnpm food:library -- --db backups/calorie-tracker-2026-07-13-153921.db
 *   pnpm food:library -- --db ./data/calorie-tracker.db --apply
 */
import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { buildClusters, type Cluster, type EntryRow } from '../utils/food-clustering.js';
import { normalizeFoodName, parseQuantity } from '../utils/food-normalize.js';

function writeReview(clusters: Cluster[], entries: EntryRow[], path: string): void {
  const totalEntries = entries.length;
  const rawNames = new Set(entries.map((entry) => entry.food_name)).size;
  const suspicious = clusters.filter((c) => c.variancePct > 25 && c.entries.length > 1);

  const lines: string[] = [
    '# Food library mapping — review before applying',
    '',
    `- Entries analysed: **${totalEntries}**`,
    `- Distinct raw names: **${rawNames}**`,
    `- Canonical foods proposed: **${clusters.length}**`,
    `- Clusters flagged for review (per-unit calories disagree >25%): **${suspicious.length}**`,
    '',
    'Per-unit macros are the **median** across every time you logged that food,',
    'so one bad historical entry cannot skew a food. `variance` is how much the',
    'entries disagree — high variance usually means two different foods got merged.',
    '',
    '## ⚠️ Flagged clusters — check these first',
    '',
  ];

  if (suspicious.length === 0) {
    lines.push('_None._', '');
  } else {
    for (const cluster of suspicious) {
      lines.push(
        `### ${cluster.canonicalName}  \`variance ${cluster.variancePct}%\` (${cluster.entries.length} entries)`,
        ''
      );
      const names = [...new Set(cluster.entries.map((e) => e.food_name))];
      for (const name of names) {
        const sample = cluster.entries.find((e) => e.food_name === name)!;
        lines.push(`- ${name} — ${sample.calories} kcal`);
      }
      lines.push('');
    }
  }

  lines.push('## All proposed foods', '');

  for (const cluster of clusters) {
    const { perUnit, unit } = cluster;
    const round = (value: number | null) =>
      value === null ? '—' : String(Math.round(value * 1000) / 1000);
    const names = [...new Set(cluster.entries.map((e) => e.food_name))];

    lines.push(
      `### ${cluster.canonicalName}`,
      `logged **${cluster.entries.length}×** · unit \`${unit}\` · default qty \`${cluster.defaultQuantity}\` · variance ${cluster.variancePct}%`,
      '',
      `| per 1 ${unit} | kcal | protein | carbs | fat |`,
      '|---|---|---|---|---|',
      `| | ${round(perUnit.calories)} | ${round(perUnit.protein)} | ${round(perUnit.carbs)} | ${round(perUnit.fat)} |`,
      ''
    );

    if (names.length > 1) {
      lines.push(`<details><summary>${names.length} raw names merged</summary>`, '');
      for (const name of names) lines.push(`- ${name}`);
      lines.push('', '</details>', '');
    }
  }

  writeFileSync(path, lines.join('\n'), 'utf8');
}

/**
 * Writes the library and links entries to it, inside a single transaction.
 *
 * Deliberately non-destructive: food_name and the logged macros on every
 * historical row are left exactly as they were. This only populates the new
 * foods/food_aliases tables and fills in the nullable food_id/quantity/unit
 * columns, so the worst case for a bad mapping is a wrong suggestion, never a
 * corrupted macro history.
 */
function applyLibrary(db: Database.Database, clusters: Cluster[]): void {
  const beforeEntries = db.prepare('SELECT COUNT(*) n FROM food_entries').get() as { n: number };
  const beforeCalories = db
    .prepare('SELECT COALESCE(SUM(calories), 0) total FROM food_entries')
    .get() as { total: number };

  const insertFood = db.prepare(`
    INSERT INTO foods (
      id, user_id, canonical_name, normalized_key, reference_unit, reference_quantity,
      calories_per_unit, protein_g_per_unit, carbs_g_per_unit, fat_g_per_unit,
      default_quantity, source
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'history')
  `);
  const insertAlias = db.prepare(`
    INSERT OR IGNORE INTO food_aliases (id, food_id, user_id, alias_key, original_name)
    VALUES (?, ?, ?, ?, ?)
  `);
  const linkEntry = db.prepare(
    'UPDATE food_entries SET food_id = ?, quantity = ?, unit = ? WHERE id = ?'
  );

  const round = (value: number | null) =>
    value === null ? null : Math.round(value * 100000) / 100000;

  const run = db.transaction(() => {
    for (const cluster of clusters) {
      const userId = cluster.entries[0]!.user_id;
      const foodId = crypto.randomUUID();

      insertFood.run(
        foodId,
        userId,
        cluster.canonicalName,
        cluster.key,
        cluster.unit,
        round(cluster.perUnit.calories),
        round(cluster.perUnit.protein),
        round(cluster.perUnit.carbs),
        round(cluster.perUnit.fat),
        cluster.defaultQuantity
      );

      const seenAliases = new Set<string>();
      for (const entry of cluster.entries) {
        const aliasKey = normalizeFoodName(entry.food_name);
        if (aliasKey && !seenAliases.has(aliasKey)) {
          seenAliases.add(aliasKey);
          insertAlias.run(crypto.randomUUID(), foodId, userId, aliasKey, entry.food_name);
        }

        const parsed = parseQuantity(entry.food_name);
        const quantity = parsed && parsed.unit === cluster.unit ? parsed.quantity : 1;
        linkEntry.run(foodId, quantity, cluster.unit, entry.id);
      }
    }
  });

  run();

  const afterEntries = db.prepare('SELECT COUNT(*) n FROM food_entries').get() as { n: number };
  const afterCalories = db
    .prepare('SELECT COALESCE(SUM(calories), 0) total FROM food_entries')
    .get() as { total: number };
  const unlinked = db
    .prepare('SELECT COUNT(*) n FROM food_entries WHERE food_id IS NULL')
    .get() as { n: number };
  const foodCount = db.prepare('SELECT COUNT(*) n FROM foods').get() as { n: number };
  const aliasCount = db.prepare('SELECT COUNT(*) n FROM food_aliases').get() as { n: number };

  console.log('\n--- validation ---');
  console.log(`entries before/after : ${beforeEntries.n} / ${afterEntries.n}`);
  console.log(`calories before/after: ${beforeCalories.total} / ${afterCalories.total}`);
  console.log(`entries unlinked     : ${unlinked.n}`);
  console.log(`foods written        : ${foodCount.n}`);
  console.log(`aliases written      : ${aliasCount.n}`);

  if (afterEntries.n !== beforeEntries.n) {
    throw new Error('Row count changed — migration is unsafe, roll back this DB copy.');
  }
  if (afterCalories.total !== beforeCalories.total) {
    throw new Error('Calorie total changed — logged macros must never be rewritten.');
  }
  if (unlinked.n > 0) {
    throw new Error(`${unlinked.n} entries were not linked to a food.`);
  }

  console.log('✓ all validations passed');
}

function main(): void {
  const args = process.argv.slice(2);
  const dbPath = args[args.indexOf('--db') + 1];
  const apply = args.includes('--apply');
  const outPath =
    args.includes('--out') ? args[args.indexOf('--out') + 1]! : 'docs/food-library-mapping.md';

  if (!dbPath || dbPath.startsWith('--')) {
    console.error('Usage: build-food-library --db <path> [--apply] [--out <path>]');
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: !apply });
  const entries = db
    .prepare('SELECT * FROM food_entries ORDER BY entry_date')
    .all() as EntryRow[];

  const clusters = buildClusters(entries);
  writeReview(clusters, entries, outPath);

  const rawNames = new Set(entries.map((e) => e.food_name)).size;
  console.log(`entries            : ${entries.length}`);
  console.log(`distinct raw names : ${rawNames}`);
  console.log(`canonical foods    : ${clusters.length}`);
  console.log(`flagged clusters   : ${clusters.filter((c) => c.variancePct > 25 && c.entries.length > 1).length}`);
  console.log(`review file        : ${outPath}`);

  if (apply) {
    applyLibrary(db, clusters);
  } else {
    console.log('\nDry run — no changes written. Re-run with --apply after reviewing.');
  }

  db.close();
}

main();
