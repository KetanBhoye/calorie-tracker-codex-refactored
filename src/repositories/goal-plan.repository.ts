export interface GoalPlan {
  id: string;
  start_weight_kg: number;
  start_date: string;
  goal_weight_kg: number;
  target_date: string;
  tolerance_kg: number;
  daily_step_goal: number | null;
  weekly_training_days: number | null;
}

export interface GoalPlanInput {
  start_weight_kg: number;
  start_date: string;
  goal_weight_kg: number;
  target_date: string;
  tolerance_kg?: number;
  daily_step_goal?: number | null;
  weekly_training_days?: number | null;
}

export class GoalPlanRepository {
  constructor(private db: any) {}

  async getActive(userId: string): Promise<GoalPlan | null> {
    const row = await this.db
      .prepare(
        `SELECT id, start_weight_kg, start_date, goal_weight_kg, target_date,
                tolerance_kg, daily_step_goal, weekly_training_days
         FROM goal_plans
         WHERE user_id = ? AND is_active = 1
         ORDER BY created_at DESC LIMIT 1`
      )
      .bind(userId)
      .first();

    return (row as GoalPlan) ?? null;
  }

  /**
   * Replaces the active plan.
   *
   * Previous plans are deactivated rather than deleted: what you were aiming
   * at three months ago is part of the record, and overwriting it would make
   * past progress impossible to interpret.
   */
  async replaceActive(userId: string, plan: GoalPlanInput): Promise<string> {
    await this.db
      .prepare('UPDATE goal_plans SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND is_active = 1')
      .bind(userId)
      .run();

    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO goal_plans (
           id, user_id, start_weight_kg, start_date, goal_weight_kg, target_date,
           tolerance_kg, daily_step_goal, weekly_training_days, is_active
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .bind(
        id,
        userId,
        plan.start_weight_kg,
        plan.start_date,
        plan.goal_weight_kg,
        plan.target_date,
        plan.tolerance_kg ?? 0.3,
        plan.daily_step_goal ?? null,
        plan.weekly_training_days ?? null
      )
      .run();

    return id;
  }
}
