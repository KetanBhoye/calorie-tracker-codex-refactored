import { describe, expect, it } from 'vitest';
import { addDays, parseISODate, toLocalISODate } from './dates';

describe('local date helpers', () => {
  it('formats a local date without shifting into the previous day', () => {
    // Regression: toISOString() converts local midnight to UTC, which in any
    // timezone ahead of UTC lands on the previous calendar day.
    const localMidnight = new Date(2026, 6, 17, 0, 0, 0);
    expect(toLocalISODate(localMidnight)).toBe('2026-07-17');
  });

  it('formats late-evening times as the same local day', () => {
    // In IST, 23:30 local is already the next day in UTC.
    expect(toLocalISODate(new Date(2026, 6, 17, 23, 30, 0))).toBe('2026-07-17');
  });

  it('pads single-digit months and days', () => {
    expect(toLocalISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('steps back exactly one day', () => {
    // The bug this guards: one "previous day" tap moved two days back.
    expect(addDays('2026-07-18', -1)).toBe('2026-07-17');
    expect(addDays('2026-07-17', -1)).toBe('2026-07-16');
  });

  it('steps forward exactly one day', () => {
    expect(addDays('2026-07-17', 1)).toBe('2026-07-18');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('round-trips through parse and format', () => {
    expect(toLocalISODate(parseISODate('2026-07-17'))).toBe('2026-07-17');
  });

  it('parses to local midnight, not UTC midnight', () => {
    const parsed = parseISODate('2026-07-17');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(6);
    expect(parsed.getDate()).toBe(17);
    expect(parsed.getHours()).toBe(0);
  });
});
