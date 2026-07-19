import { FoodLibraryRepository } from '../repositories/food-library.repository.js';
import { parseQuantity } from '../utils/food-normalize.js';
import type { AddEntryParams } from '../types/index.js';

/**
 * Resolves a free-text entry onto a canonical library food.
 *
 * Suggestions rank by joining food_entries to foods, so an entry with a null
 * food_id never influences them. Both write paths need this: the PWA supplies
 * food_id directly, while MCP and any other client send only a name.
 *
 * Shared deliberately — this logic previously lived in the HTTP route alone,
 * which meant conversational logging quietly stopped feeding the ranking.
 */
export async function linkEntryToFood(
  db: unknown,
  userId: string,
  entry: AddEntryParams
): Promise<AddEntryParams> {
  if (entry.food_id) return entry;

  let match: Awaited<ReturnType<FoodLibraryRepository['findByName']>> = null;
  try {
    match = await new FoodLibraryRepository(db).findByName(userId, entry.food_name);
  } catch (error) {
    // Linking is an enhancement, not a precondition. Losing a suggestion is a
    // far smaller failure than refusing to record what someone ate, so a
    // lookup failure degrades to an unlinked entry.
    console.error('Food linking failed, saving entry unlinked:', error);
    return entry;
  }

  if (!match) return entry;

  // Take the portion from the name when it agrees with the food's unit, so
  // "Cooked Rice (200g)" records quantity 200 rather than defaulting to 1.
  const parsed = parseQuantity(entry.food_name);
  const quantity =
    entry.quantity ?? (parsed && parsed.unit === match.reference_unit ? parsed.quantity : undefined);

  return {
    ...entry,
    food_id: match.id,
    quantity,
    unit: entry.unit ?? match.reference_unit,
  };
}
