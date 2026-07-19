import type { GoalPlan } from '../repositories/goal-plan.repository.js';

export interface WeighIn {
  recorded_date: string;
  weight_kg: number | null;
}

export interface GlideWeek {
  week: number;
  date: string;
  target_kg: number;
  /** Actual weight for that week, if one was recorded near it. */
  actual_kg: number | null;
  status: 'ahead' | 'on' | 'watch' | 'behind' | 'empty';
}

/** Energy in a kilogram of body mass; the standard planning figure. */
export const KCAL_PER_KG = 7700;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().split('T')[0]!;
}

function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  const a = Date.UTC(y1!, (m1 ?? 1) - 1, d1 ?? 1);
  const b = Date.UTC(y2!, (m2 ?? 1) - 1, d2 ?? 1);
  return Math.round((b - a) / 86_400_000);
}

function statusFor(
  actual: number | null,
  target: number,
  tolerance: number,
  losing: boolean
): GlideWeek['status'] {
  if (actual === null) return 'empty';

  // "Ahead" means further along the intended direction, which flips between a
  // cut and a bulk — comparing raw numbers would label a successful bulk as
  // failing.
  const delta = losing ? actual - target : target - actual;
  if (delta < -tolerance) return 'ahead';
  if (delta <= tolerance) return 'on';
  if (delta <= tolerance * 2) return 'watch';
  return 'behind';
}

/**
 * Builds the weekly glide path and matches each week to the nearest weigh-in.
 *
 * Weigh-ins rarely land exactly on a week boundary, so each week claims the
 * closest reading within ±3 days. Beyond that the week is left empty rather
 * than borrowing a stale number, which would flatter or punish a week that was
 * never actually measured.
 */
export function buildGlidePath(plan: GoalPlan, weighIns: WeighIn[]): GlideWeek[] {
  const totalDays = daysBetween(plan.start_date, plan.target_date);
  if (totalDays <= 0) return [];

  const weeks = Math.max(1, Math.ceil(totalDays / 7));
  const losing = plan.goal_weight_kg < plan.start_weight_kg;
  const perWeek = (plan.goal_weight_kg - plan.start_weight_kg) / weeks;

  const readings = weighIns
    .filter((w): w is WeighIn & { weight_kg: number } => w.weight_kg !== null)
    .sort((a, b) => a.recorded_date.localeCompare(b.recorded_date));

  const path: GlideWeek[] = [];

  for (let week = 0; week <= weeks; week += 1) {
    const date = week === weeks ? plan.target_date : addDays(plan.start_date, week * 7);
    const target =
      week === weeks
        ? plan.goal_weight_kg
        : Math.round((plan.start_weight_kg + perWeek * week) * 100) / 100;

    let actual: number | null = null;
    let closest = Number.POSITIVE_INFINITY;
    for (const reading of readings) {
      const distance = Math.abs(daysBetween(date, reading.recorded_date));
      if (distance <= 3 && distance < closest) {
        closest = distance;
        actual = reading.weight_kg;
      }
    }

    path.push({
      week,
      date,
      target_kg: target,
      actual_kg: actual,
      status: statusFor(actual, target, plan.tolerance_kg, losing),
    });
  }

  return path;
}

export interface DeficitDay {
  date: string;
  intake_kcal: number;
  /** TDEE from the profile, plus any active energy not already counted in it. */
  expenditure_kcal: number | null;
  deficit_kcal: number | null;
}

/**
 * Daily energy balance.
 *
 * Expenditure uses the recorded TDEE, which already includes typical activity.
 * Active energy from Apple Health is deliberately NOT added on top — doing so
 * double-counts the movement TDEE already assumes and inflates the deficit,
 * which is the single most common way this kind of tracker lies to you.
 */
export function buildDeficitSeries(
  intakeByDate: Map<string, number>,
  tdeeByDate: Map<string, number>,
  fallbackTdee: number | null
): DeficitDay[] {
  const days = [...intakeByDate.keys()].sort();

  return days.map((date) => {
    const intake = intakeByDate.get(date)!;

    // Carry the most recent TDEE at or before this day; body composition is
    // measured every few days, not daily.
    let tdee: number | null = fallbackTdee;
    let bestDate = '';
    for (const [recorded, value] of tdeeByDate) {
      if (recorded <= date && recorded > bestDate) {
        bestDate = recorded;
        tdee = value;
      }
    }

    return {
      date,
      intake_kcal: intake,
      expenditure_kcal: tdee,
      deficit_kcal: tdee === null ? null : Math.round(tdee - intake),
    };
  });
}

/** Groups deficit days into ISO weeks, reporting only weeks with real coverage. */
export function weeklyDeficit(
  days: DeficitDay[],
  minDaysPerWeek = 4
): Array<{ week_start: string; days_logged: number; total_deficit: number; projected_kg: number }> {
  const buckets = new Map<string, DeficitDay[]>();

  for (const day of days) {
    if (day.deficit_kcal === null) continue;
    const [y, m, d] = day.date.split('-').map(Number);
    const parsed = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
    // Monday-start weeks.
    const offset = (parsed.getUTCDay() + 6) % 7;
    parsed.setUTCDate(parsed.getUTCDate() - offset);
    const key = parsed.toISOString().split('T')[0]!;

    const bucket = buckets.get(key);
    if (bucket) bucket.push(day);
    else buckets.set(key, [day]);
  }

  return [...buckets.entries()]
    // A week with two logged days isn't a week — reporting it as one would
    // show a deficit that mostly reflects the days that went unlogged.
    .filter(([, bucket]) => bucket.length >= minDaysPerWeek)
    .map(([week_start, bucket]) => {
      const total = bucket.reduce((sum, day) => sum + (day.deficit_kcal ?? 0), 0);
      return {
        week_start,
        days_logged: bucket.length,
        total_deficit: Math.round(total),
        projected_kg: Math.round((total / KCAL_PER_KG) * 100) / 100,
      };
    })
    .sort((a, b) => a.week_start.localeCompare(b.week_start));
}
