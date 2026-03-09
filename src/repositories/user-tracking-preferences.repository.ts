import type { SetUserPreferencesParams, UserTrackingPreferences } from '../types/index.js';

type UpsertUserTrackingPreferencesInput = SetUserPreferencesParams;

export class UserTrackingPreferencesRepository {
  constructor(private db: any) {}

  async getByUserId(userId: string): Promise<UserTrackingPreferences | null> {
    const result = await this.db
      .prepare('SELECT * FROM user_tracking_preferences WHERE user_id = ?')
      .bind(userId)
      .first();

    return (result as UserTrackingPreferences | null) || null;
  }

  async upsert(userId: string, updates: UpsertUserTrackingPreferencesInput): Promise<UserTrackingPreferences> {
    const existing = await this.getByUserId(userId);

    if (!existing) {
      const result = await this.db
        .prepare(`
          INSERT INTO user_tracking_preferences (
            user_id, display_name, daily_calorie_goal, daily_protein_goal_g,
            daily_carbs_goal_g, daily_fat_goal_g, behavior_instructions, macros_cache_notes,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING *
        `)
        .bind(
          userId,
          updates.display_name || null,
          updates.daily_calorie_goal ?? null,
          updates.daily_protein_goal_g ?? null,
          updates.daily_carbs_goal_g ?? null,
          updates.daily_fat_goal_g ?? null,
          updates.behavior_instructions || null,
          updates.macros_cache_notes || null
        )
        .first();

      if (!result) {
        throw new Error('Failed to create user tracking preferences');
      }

      return result as UserTrackingPreferences;
    }

    const fields: string[] = [];
    const values: Array<string | number> = [];

    if (updates.display_name !== undefined) {
      fields.push('display_name = ?');
      values.push(updates.display_name);
    }
    if (updates.daily_calorie_goal !== undefined) {
      fields.push('daily_calorie_goal = ?');
      values.push(updates.daily_calorie_goal);
    }
    if (updates.daily_protein_goal_g !== undefined) {
      fields.push('daily_protein_goal_g = ?');
      values.push(updates.daily_protein_goal_g);
    }
    if (updates.daily_carbs_goal_g !== undefined) {
      fields.push('daily_carbs_goal_g = ?');
      values.push(updates.daily_carbs_goal_g);
    }
    if (updates.daily_fat_goal_g !== undefined) {
      fields.push('daily_fat_goal_g = ?');
      values.push(updates.daily_fat_goal_g);
    }
    if (updates.behavior_instructions !== undefined) {
      fields.push('behavior_instructions = ?');
      values.push(updates.behavior_instructions);
    }
    if (updates.macros_cache_notes !== undefined) {
      fields.push('macros_cache_notes = ?');
      values.push(updates.macros_cache_notes);
    }

    if (fields.length === 0) {
      return existing;
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(userId);

    const result = await this.db
      .prepare(`
        UPDATE user_tracking_preferences
        SET ${fields.join(', ')}
        WHERE user_id = ?
        RETURNING *
      `)
      .bind(...values)
      .first();

    if (!result) {
      throw new Error('Failed to update user tracking preferences');
    }

    return result as UserTrackingPreferences;
  }
}
