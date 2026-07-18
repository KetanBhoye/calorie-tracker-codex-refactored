/**
 * Food name normalisation.
 *
 * Historical entries were written as free text by an LLM, so the same food
 * appears under many spellings ("Avvatar Whey (1 scoop)", "Avvatar Isorich
 * Shake", "Avvatar Whey Protein (1 scoop, evening)"). Normalising to a stable
 * key lets the library collapse those onto one canonical food, which is what
 * makes frequency-based suggestions meaningful.
 */

export interface ParsedQuantity {
  quantity: number;
  unit: string;
}

/** Units we recognise inside a free-text food name, mapped to a canonical unit. */
const UNIT_ALIASES: Record<string, string> = {
  g: 'g',
  gm: 'g',
  gms: 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
  litre: 'l',
  scoop: 'scoop',
  scoops: 'scoop',
  pc: 'piece',
  pcs: 'piece',
  piece: 'piece',
  pieces: 'piece',
  slice: 'slice',
  slices: 'slice',
  can: 'can',
  cans: 'can',
  katori: 'katori',
  tsp: 'tsp',
  tbsp: 'tbsp',
  cup: 'cup',
  cups: 'cup',
};

/**
 * Descriptors that carry no identity information for a food.
 *
 * Grouped by why they're noise. Note what is deliberately absent: preparation
 * words that change macros per gram ("cooked", "raw", "fried", "boiled") are
 * NOT noise, because 100g raw chicken and 100g cooked chicken are different
 * foods nutritionally.
 */
const NOISE_WORDS = new Set([
  // Hedges and filler
  'approx',
  'about',
  'roughly',
  'whole',
  'plain',
  'the',
  'a',
  'an',
  'and',
  'with',
  'w',
  'of',
  'total',
  'each',
  'combined',
  'estimated',
  'est',
  'no',
  'extra',
  // When it was eaten — irrelevant to what it is. The meal slot is already a
  // separate column, so "(1 scoop, evening)" must not fork a new food.
  'pre',
  'post',
  'workout',
  'morning',
  'evening',
  'afternoon',
  'night',
  'breakfast',
  'lunch',
  'dinner',
  'snack',
  'nd',
  'rd',
  'st',
  'th',
  // Flavour variants of the same product — macros are near-identical, and
  // splitting "Malai Kulfi" from plain whey fragments the top-logged food.
  'flavour',
  'flavor',
  'malai',
  'kulfi',
  'chocolate',
  'vanilla',
  'unflavoured',
  'unflavored',
  // How it was served, not what it is
  'shake',
  'water',
  'glass',
]);

/**
 * Product-line synonyms: different names for the same item in this user's log.
 * Kept deliberately small and explicit — this is domain knowledge that no
 * amount of string similarity can infer. Extend it as new products appear.
 */
const TOKEN_SYNONYMS: Record<string, string> = {
  // "Avvatar Isorich" is the whey product; both spellings appear in the log.
  isorich: 'whey',
  mb: 'muscleblaze',
  hp: 'protein',
  egg: 'eggs',
  chapatti: 'chapati',
  roti: 'chapati',
  curd: 'dahi',
  yoghurt: 'yogurt',
};

const QUANTITY_UNIT_RE = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*(${Object.keys(UNIT_ALIASES).join('|')})\\b`,
  'i'
);

/**
 * Pull the first quantity+unit out of a food name.
 * "Cooked Rice (160g)" -> { quantity: 160, unit: 'g' }
 * "Chapati (2)"        -> { quantity: 2, unit: 'piece' }
 */
export function parseQuantity(name: string): ParsedQuantity | null {
  const withUnit = name.match(QUANTITY_UNIT_RE);
  if (withUnit?.[1] && withUnit[2]) {
    const quantity = Number.parseFloat(withUnit[1]);
    const unit = UNIT_ALIASES[withUnit[2].toLowerCase()];
    if (Number.isFinite(quantity) && unit) {
      return { quantity, unit };
    }
  }

  // Leading bare count: "2 chapatis", "3 Boiled Eggs". Without this the
  // quantity reads as 1 and per-unit macros come out N times too high.
  const leadingCount = name.match(/^\s*(\d{1,2})\s+[a-z]/i);
  if (leadingCount?.[1]) {
    const quantity = Number.parseInt(leadingCount[1], 10);
    if (quantity > 0 && quantity <= 20) {
      return { quantity, unit: 'piece' };
    }
  }

  // Bare count: "Chapati (2)", "Boiled Eggs x3", "Whole eggs (3, boiled)"
  const bareCount = name.match(/(?:\(|\bx\s*)(\d+)(?:[,)\s]|$)/i);
  if (bareCount?.[1]) {
    const quantity = Number.parseInt(bareCount[1], 10);
    if (Number.isFinite(quantity) && quantity > 0 && quantity <= 20) {
      return { quantity, unit: 'piece' };
    }
  }

  return null;
}

/**
 * Reduce a free-text food name to a matching key: lowercase, quantities and
 * parentheticals removed, punctuation flattened, noise words dropped, tokens
 * sorted so word order doesn't split a cluster.
 */
export function normalizeFoodName(name: string): string {
  let s = name.toLowerCase();

  // Keep the words inside parentheses ("(3, boiled)" -> "boiled") so that a
  // descriptor sitting inside brackets in one entry and outside them in
  // another still produces the same key. Quantity stripping below removes the
  // numbers. Preparation words like "cooked"/"raw" are deliberately NOT treated
  // as noise: they change macros per gram for meat.
  s = s.replace(/[()]/g, ' ');
  s = s.replace(/₹\s*\d+/g, ' ');
  s = s.replace(
    new RegExp(`\\d+(?:\\.\\d+)?\\s*(?:${Object.keys(UNIT_ALIASES).join('|')})\\b`, 'gi'),
    ' '
  );
  s = s.replace(/\bx\s*\d+\b/gi, ' ');
  s = s.replace(/\d+(?:\.\d+)?/g, ' ');
  s = s.replace(/[^a-z\s]/g, ' ');

  const tokens = s
    .split(/\s+/)
    .filter((token) => token.length > 1 && !NOISE_WORDS.has(token))
    .map((token) => TOKEN_SYNONYMS[token] ?? token)
    .filter((token) => !NOISE_WORDS.has(token));

  return [...new Set(tokens)].sort().join(' ');
}

/**
 * Scale per-unit macros to a logged quantity, rounding the way the existing
 * entries do (calories integer, macros to 1dp).
 */
export function scaleMacros(
  perUnit: {
    calories_per_unit: number;
    protein_g_per_unit?: number | null;
    carbs_g_per_unit?: number | null;
    fat_g_per_unit?: number | null;
  },
  quantity: number
): {
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
} {
  const scale = (value: number | null | undefined): number | null =>
    value === null || value === undefined ? null : Math.round(value * quantity * 10) / 10;

  return {
    calories: Math.round(perUnit.calories_per_unit * quantity),
    protein_g: scale(perUnit.protein_g_per_unit),
    carbs_g: scale(perUnit.carbs_g_per_unit),
    fat_g: scale(perUnit.fat_g_per_unit),
  };
}
