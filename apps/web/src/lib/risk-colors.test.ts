import { describe, it, expect } from 'vitest';
import { RISK_COLORS, colorForRate, riskLevel } from './risk-colors';

describe('riskLevel / colorForRate', () => {
  it.each([
    [0, 'high'],
    [49, 'high'],
    [50, 'medium'],
    [80, 'medium'],
    [81, 'low'],
    [100, 'low'],
  ] as const)('%i%% => %s', (rate, level) => {
    expect(riskLevel(rate)).toBe(level);
    expect(colorForRate(rate)).toBe(RISK_COLORS[level]);
  });

  it('null (brak danych) => neutralny szary, nie czerwony', () => {
    expect(riskLevel(null)).toBe('unknown');
  });
});
