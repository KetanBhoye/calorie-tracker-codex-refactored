import { describe, expect, it } from 'vitest';
import {
  buildDeficitSeries,
  buildGlidePath,
  weeklyDeficit,
  type WeighIn,
} from './goal-progress.js';
import type { GoalPlan } from '../repositories/goal-plan.repository.js';

const CUT: GoalPlan = {
  id: 'p1',
  start_weight_kg: 70.7,
  start_date: '2026-07-19',
  goal_weight_kg: 68,
  target_date: '2026-08-30',
  tolerance_kg: 0.3,
  daily_step_goal: 15000,
  weekly_training_days: 6,
};

describe('buildGlidePath', () => {
  it('descends from start to goal and lands exactly on target', () => {
    const path = buildGlidePath(CUT, []);

    expect(path[0]!.target_kg).toBe(70.7);
    expect(path[path.length - 1]!.target_kg).toBe(68);
    expect(path[path.length - 1]!.date).toBe('2026-08-30');
  });

  it('spaces weeks seven days apart', () => {
    const path = buildGlidePath(CUT, []);
    expect(path[0]!.date).toBe('2026-07-19');
    expect(path[1]!.date).toBe('2026-07-26');
    expect(path[2]!.date).toBe('2026-08-02');
  });

  it('matches a weigh-in within three days of the week marker', () => {
    const weighIns: WeighIn[] = [{ recorded_date: '2026-07-27', weight_kg: 70.2 }];
    const path = buildGlidePath(CUT, weighIns);

    expect(path[1]!.actual_kg).toBe(70.2);
    expect(path[1]!.status).toBe('on');
  });

  it('leaves a week empty rather than borrowing a distant reading', () => {
    // A reading 10 days away says nothing about this week.
    const path = buildGlidePath(CUT, [{ recorded_date: '2026-08-05', weight_kg: 69.5 }]);

    expect(path[1]!.actual_kg).toBeNull();
    expect(path[1]!.status).toBe('empty');
  });

  it('prefers the closest reading when several are in range', () => {
    const path = buildGlidePath(CUT, [
      { recorded_date: '2026-07-24', weight_kg: 70.5 },
      { recorded_date: '2026-07-26', weight_kg: 70.1 },
    ]);

    expect(path[1]!.actual_kg).toBe(70.1);
  });

  it('grades a cut: below target is ahead, above is behind', () => {
    const ahead = buildGlidePath(CUT, [{ recorded_date: '2026-07-26', weight_kg: 69.5 }]);
    const behind = buildGlidePath(CUT, [{ recorded_date: '2026-07-26', weight_kg: 71.2 }]);

    expect(ahead[1]!.status).toBe('ahead');
    expect(behind[1]!.status).toBe('behind');
  });

  it('flips the grading for a bulk', () => {
    // Gaining: above the target line is ahead, not behind.
    const bulk: GoalPlan = {
      ...CUT,
      start_weight_kg: 68,
      goal_weight_kg: 72,
    };
    const path = buildGlidePath(bulk, [{ recorded_date: '2026-07-26', weight_kg: 69.5 }]);

    expect(path[1]!.status).toBe('ahead');
  });

  it('ignores weigh-ins with no weight recorded', () => {
    const path = buildGlidePath(CUT, [{ recorded_date: '2026-07-26', weight_kg: null }]);
    expect(path[1]!.actual_kg).toBeNull();
  });

  it('returns nothing for a target date on or before the start', () => {
    expect(buildGlidePath({ ...CUT, target_date: '2026-07-19' }, [])).toEqual([]);
  });
});

describe('buildDeficitSeries', () => {
  it('computes deficit as TDEE minus intake', () => {
    const [day] = buildDeficitSeries(
      new Map([['2026-07-18', 1800]]),
      new Map([['2026-07-15', 2800]]),
      null
    );

    expect(day!.deficit_kcal).toBe(1000);
  });

  it('carries forward the most recent TDEE at or before the day', () => {
    const days = buildDeficitSeries(
      new Map([
        ['2026-07-10', 1800],
        ['2026-07-20', 1800],
      ]),
      new Map([
        ['2026-07-01', 2600],
        ['2026-07-15', 2900],
      ]),
      null
    );

    expect(days[0]!.expenditure_kcal).toBe(2600);
    expect(days[1]!.expenditure_kcal).toBe(2900);
  });

  it('reports null rather than guessing when no TDEE is known', () => {
    const [day] = buildDeficitSeries(new Map([['2026-07-18', 1800]]), new Map(), null);
    expect(day!.deficit_kcal).toBeNull();
  });
});

describe('weeklyDeficit', () => {
  const dayFor = (date: string, deficit: number) => ({
    date,
    intake_kcal: 1800,
    expenditure_kcal: 1800 + deficit,
    deficit_kcal: deficit,
  });

  it('sums a full week and projects the loss', () => {
    // 7 x 700 = 4900 kcal ≈ 0.64 kg
    const days = [
      '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16',
      '2026-07-17', '2026-07-18', '2026-07-19',
    ].map((d) => dayFor(d, 700));

    const [week] = weeklyDeficit(days);

    expect(week!.week_start).toBe('2026-07-13');
    expect(week!.days_logged).toBe(7);
    expect(week!.total_deficit).toBe(4900);
    expect(week!.projected_kg).toBeCloseTo(0.64, 2);
  });

  it('drops weeks with too few logged days', () => {
    // Two days is not a week; reporting it would show a deficit that mostly
    // reflects the days that went unlogged.
    const days = [dayFor('2026-07-13', 700), dayFor('2026-07-14', 700)];
    expect(weeklyDeficit(days)).toEqual([]);
  });

  it('groups into Monday-start weeks', () => {
    const days = [
      // Sunday belongs to the week that began the previous Monday.
      dayFor('2026-07-19', 500),
      dayFor('2026-07-18', 500),
      dayFor('2026-07-17', 500),
      dayFor('2026-07-16', 500),
    ];

    const [week] = weeklyDeficit(days);
    expect(week!.week_start).toBe('2026-07-13');
  });

  it('skips days with an unknown deficit', () => {
    const days = [
      ...['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16'].map((d) => dayFor(d, 600)),
      { date: '2026-07-17', intake_kcal: 1800, expenditure_kcal: null, deficit_kcal: null },
    ];

    const [week] = weeklyDeficit(days);
    expect(week!.days_logged).toBe(4);
    expect(week!.total_deficit).toBe(2400);
  });
});
