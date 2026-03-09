import { describe, expect, it } from 'vitest';
import { getConfig } from './config.js';

describe('Application config', () => {
  it('loads portable defaults', () => {
    const config = getConfig();

    expect(config.port).toBeGreaterThan(0);
    expect(config.databasePath).toContain('calorie-tracker.db');
    expect(config.sessionTtlHours).toBeGreaterThan(0);
    expect(config.adminApiKey.length).toBeGreaterThan(0);
  });
});
