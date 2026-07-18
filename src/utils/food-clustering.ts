/**
 * Clusters free-text food names from logging history into canonical foods.
 *
 * Extracted from the migration script so the merge rules are unit-testable:
 * a silent over-merge or a dropped entry here would corrupt macro history.
 */
import { normalizeFoodName, parseQuantity } from './food-normalize.js';

export interface EntryRow {
  id: string;
  user_id: string;
  food_name: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  meal_type: string | null;
  entry_date: string;
}

export interface Cluster {
  key: string;
  canonicalName: string;
  entries: EntryRow[];
  unit: string;
  perUnit: {
    calories: number;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
  };
  defaultQuantity: number;
  /** Spread of per-unit calories across the cluster; high => suspicious merge. */
  variancePct: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function mode<T>(values: T[], fallback: T): T {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = fallback;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Pick the display name for a cluster: the most frequently logged spelling,
 * tie-broken by the shortest (shorter names are usually the cleaner ones).
 */
function pickCanonicalName(entries: EntryRow[]): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.food_name, (counts.get(entry.food_name) ?? 0) + 1);
  }

  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].length - b[0].length
  )[0]![0];
}

export function buildClusters(entries: EntryRow[]): Cluster[] {
  const byKey = new Map<string, EntryRow[]>();
  for (const entry of entries) {
    const key = normalizeFoodName(entry.food_name);
    if (!key) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(entry);
    else byKey.set(key, [entry]);
  }

  const grouped = [...byKey.entries()].map(([key, clusterEntries]) => ({ key, clusterEntries }));
  return mergeSubsetClusters(
    computeStats(grouped).sort((a, b) => b.entries.length - a.entries.length)
  );
}

/** Derives per-unit macros, unit and variance for each grouped set of entries. */
function computeStats(
  groups: Array<{ key: string; clusterEntries: EntryRow[] }>
): Cluster[] {
  const clusters: Cluster[] = [];

  for (const { key, clusterEntries } of groups) {
    const quantities = clusterEntries.map((entry) => parseQuantity(entry.food_name));
    const units = quantities.filter((q) => q !== null).map((q) => q!.unit);
    // A cluster only gets a real unit if the majority of its entries agree.
    const unit = units.length >= clusterEntries.length / 2 ? mode(units, 'serving') : 'serving';

    const perUnitCalories: number[] = [];
    const perUnitProtein: number[] = [];
    const perUnitCarbs: number[] = [];
    const perUnitFat: number[] = [];
    const quantityValues: number[] = [];

    clusterEntries.forEach((entry, index) => {
      const parsed = quantities[index];
      const qty = parsed && parsed.unit === unit && parsed.quantity > 0 ? parsed.quantity : 1;
      quantityValues.push(qty);
      perUnitCalories.push(entry.calories / qty);
      if (entry.protein_g !== null) perUnitProtein.push(entry.protein_g / qty);
      if (entry.carbs_g !== null) perUnitCarbs.push(entry.carbs_g / qty);
      if (entry.fat_g !== null) perUnitFat.push(entry.fat_g / qty);
    });

    const medianCalories = median(perUnitCalories);
    // How far the entries disagree about calories-per-unit. Large spread means
    // normalisation probably merged two different foods.
    const deviations = perUnitCalories.map((value) =>
      medianCalories > 0 ? Math.abs(value - medianCalories) / medianCalories : 0
    );
    const variancePct = Math.round(median(deviations) * 100);

    clusters.push({
      key,
      canonicalName: pickCanonicalName(clusterEntries),
      entries: clusterEntries,
      unit,
      perUnit: {
        calories: medianCalories,
        protein: perUnitProtein.length ? median(perUnitProtein) : null,
        carbs: perUnitCarbs.length ? median(perUnitCarbs) : null,
        fat: perUnitFat.length ? median(perUnitFat) : null,
      },
      defaultQuantity: mode(quantityValues, 1),
      variancePct,
    });
  }

  return clusters;
}

/**
 * Second pass: absorb clusters whose token set is a subset of a larger
 * cluster's, when the two agree on macros.
 *
 * The history is full of the same food written with varying detail — "Avvatar
 * Whey" / "Avvatar Whey Protein" / "Avvatar Whey Protein Shake", or "Eggs" /
 * "Boiled Eggs". Token-set normalisation alone keeps those apart. Requiring the
 * per-unit calories to agree within 20% and the units to match is what stops
 * this from merging genuinely different foods ("Rice" would otherwise swallow
 * "Rice Kheer").
 */
function mergeSubsetClusters(clusters: Cluster[]): Cluster[] {
  const CALORIE_TOLERANCE = 0.2;
  // Tracked by object identity, not by key: keys are narrowed to the shared
  // core during merging, so a key-based set would drop a target whose narrowed
  // key collides with one it already absorbed.
  const absorbed = new Set<Cluster>();

  // Largest first, so smaller variants collapse into the dominant spelling.
  for (const target of clusters) {
    if (absorbed.has(target)) continue;
    const targetTokens = new Set(target.key.split(' ').filter(Boolean));

    for (const candidate of clusters) {
      if (candidate === target || absorbed.has(candidate)) continue;
      if (candidate.entries.length > target.entries.length) continue;

      // Check containment in BOTH directions. The most-logged spelling is
      // often the terse one ("Avvatar Whey", 19x) while the variants add
      // descriptors ("Avvatar Whey Protein (1 scoop, evening)"), so requiring
      // the candidate to be the subset would never fire on the real data.
      const candidateTokens = candidate.key.split(' ').filter(Boolean);
      if (candidateTokens.length === 0 || targetTokens.size === 0) continue;

      const contained =
        candidateTokens.every((token) => targetTokens.has(token)) ||
        [...targetTokens].every((token) => candidateTokens.includes(token));
      if (!contained) continue;

      // Never let the shared core erode to nothing: an empty token set makes
      // every containment check vacuously true, which would turn this cluster
      // into a sink that swallows unrelated foods.
      const sharedCore = [...targetTokens].filter((token) => candidateTokens.includes(token));
      if (sharedCore.length === 0) continue;

      if (candidate.unit !== target.unit) continue;

      const base = target.perUnit.calories;
      if (base <= 0) continue;
      const delta = Math.abs(candidate.perUnit.calories - base) / base;
      if (delta > CALORIE_TOLERANCE) continue;

      target.entries.push(...candidate.entries);
      absorbed.add(candidate);

      // Narrow the target's key to the tokens both agree on, so the cluster is
      // now identified by its shared core. Without this the merge is not
      // transitive: "avvatar isorich whey" and "avvatar protein whey" both
      // contain "avvatar whey", but neither contains the other, so whichever
      // absorbed "avvatar whey" first would strand the other.
      targetTokens.clear();
      for (const token of sharedCore) targetTokens.add(token);
      target.key = sharedCore.sort().join(' ');
    }
  }

  const merged = clusters.filter((cluster) => !absorbed.has(cluster));

  // Invariant: merging redistributes entries, it never creates or destroys
  // them. This guards the whole migration — a silent drop here would mean
  // losing logged history.
  const expectedIds = new Set(clusters.flatMap((c) => c.entries.map((e) => e.id)));
  const actualIds = new Set(merged.flatMap((c) => c.entries.map((e) => e.id)));
  if (actualIds.size !== expectedIds.size) {
    throw new Error(
      `Merge lost entries: ${actualIds.size} unique entry ids after merge, expected ${expectedIds.size}`
    );
  }

  // Recompute stats for clusters that absorbed others, so per-unit macros and
  // variance reflect the full merged set rather than the pre-merge subset.
  return computeStats(
    merged.map((cluster) => ({ key: cluster.key, clusterEntries: cluster.entries }))
  ).sort((a, b) => b.entries.length - a.entries.length);
}

