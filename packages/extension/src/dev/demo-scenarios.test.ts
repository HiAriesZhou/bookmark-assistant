import { describe, expect, it } from 'vitest';
import {
  createDemoScenarios,
  DEFAULT_DEMO_TIME,
  DEMO_SCENARIO_IDS,
  parseDemoConfig,
} from './demo-scenarios';

describe('deterministic demo scenarios', () => {
  it('provides all required scenarios with frozen aggregate-only dashboard data', () => {
    const scenarios = createDemoScenarios(Date.parse(DEFAULT_DEMO_TIME));
    expect(Object.keys(scenarios)).toEqual(DEMO_SCENARIO_IDS);
    for (const scenario of Object.values(scenarios)) {
      expect(scenario.dashboard.generatedAt).toBe(DEFAULT_DEMO_TIME);
      expect(scenario.dashboard.libraryHealth.version).toBe(1);
      expect(JSON.stringify(scenario.dashboard)).not.toMatch(/https?:\/\//i);
    }
  });

  it('validates scenario, locale, and time query parameters', () => {
    expect(parseDemoConfig('?scenario=auto-sync&locale=zh-CN&time=2026-08-01T00:00:00Z')).toEqual({
      scenarioId: 'auto-sync',
      locale: 'zh-CN',
      frozenTime: '2026-08-01T00:00:00.000Z',
    });
    expect(parseDemoConfig('?scenario=unknown&locale=fr&time=invalid')).toEqual({
      scenarioId: 'connected',
      locale: 'en',
      frozenTime: DEFAULT_DEMO_TIME,
    });
  });
});
