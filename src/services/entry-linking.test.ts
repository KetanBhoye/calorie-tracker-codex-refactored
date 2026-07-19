import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { SqliteD1Database } from '../db/sqlite-adapter.js';
import { linkEntryToFood } from './entry-linking.js';

let raw: Database.Database;
let db: SqliteD1Database;

beforeEach(() => {
  raw = new Database(':memory:');
  raw.exec(`
    CREATE TABLE foods (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, canonical_name TEXT NOT NULL,
      normalized_key TEXT NOT NULL, reference_unit TEXT NOT NULL,
      reference_quantity REAL NOT NULL DEFAULT 1, calories_per_unit REAL NOT NULL,
      protein_g_per_unit REAL, carbs_g_per_unit REAL, fat_g_per_unit REAL,
      default_quantity REAL NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'history'
    );
    CREATE TABLE food_aliases (
      id TEXT PRIMARY KEY, food_id TEXT NOT NULL, user_id TEXT NOT NULL,
      alias_key TEXT NOT NULL, original_name TEXT NOT NULL
    );
    INSERT INTO foods (id, user_id, canonical_name, normalized_key, reference_unit,
      calories_per_unit, default_quantity)
    VALUES ('rice-1', 'admin', 'Cooked White Rice (150g)', 'cooked rice white', 'g', 1.3, 150);
  `);
  db = new SqliteD1Database(raw);
});

describe('linkEntryToFood', () => {
  it('links a free-text entry to the canonical food', async () => {
    // Regression: MCP wrote entries straight to the repository, so anything
    // logged conversationally had a null food_id and never fed suggestions.
    const linked = await linkEntryToFood(db, 'admin', {
      food_name: 'White rice cooked (200g)',
      calories: 260,
    });

    expect(linked.food_id).toBe('rice-1');
    expect(linked.unit).toBe('g');
  });

  it('takes the portion from the name when the unit matches', async () => {
    const linked = await linkEntryToFood(db, 'admin', {
      food_name: 'Cooked White Rice (200g)',
      calories: 260,
    });

    expect(linked.quantity).toBe(200);
  });

  it('leaves an explicit food_id untouched', async () => {
    const linked = await linkEntryToFood(db, 'admin', {
      food_name: 'anything',
      calories: 100,
      food_id: 'already-known',
    });

    expect(linked.food_id).toBe('already-known');
  });

  it('leaves an unmatched food unlinked rather than guessing', async () => {
    const linked = await linkEntryToFood(db, 'admin', {
      food_name: 'Something Never Eaten Before',
      calories: 100,
    });

    expect(linked.food_id).toBeUndefined();
  });

  it('does not link across users', async () => {
    const linked = await linkEntryToFood(db, 'someone-else', {
      food_name: 'Cooked White Rice (150g)',
      calories: 195,
    });

    expect(linked.food_id).toBeUndefined();
  });
});

describe('resilience', () => {
  it('still returns the entry when the library lookup fails', async () => {
    // Refusing to record what someone ate because a suggestion lookup broke
    // would be a much worse failure than losing the link.
    const brokenDb = {
      prepare() {
        throw new Error('database unavailable');
      },
    };

    const linked = await linkEntryToFood(brokenDb, 'admin', {
      food_name: 'Chapati (2)',
      calories: 200,
    });

    expect(linked.food_id).toBeUndefined();
    expect(linked.calories).toBe(200);
  });
});
