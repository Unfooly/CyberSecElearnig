export type RiskLevel = 'high' | 'medium' | 'low' | 'unknown';

export const RISK_COLORS: Record<RiskLevel, string> = {
  high: '#dc2626',
  medium: '#f59e0b',
  low: '#16a34a',
  unknown: '#94a3b8',
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  high: 'Wysokie ryzyko (<50%)',
  medium: 'Średnie ryzyko (50-80%)',
  low: 'Niskie ryzyko (>80%)',
  unknown: 'Brak danych',
};

// Progi z wymagań zarządu: czerwony <50%, żółty 50-80% (włącznie z 80),
// zielony >80%. null = dział bez obowiązkowych przypisań (brak danych).
export function riskLevel(rate: number | null): RiskLevel {
  if (rate === null) {
    return 'unknown';
  }
  if (rate < 50) {
    return 'high';
  }
  if (rate <= 80) {
    return 'medium';
  }
  return 'low';
}

export function colorForRate(rate: number | null): string {
  return RISK_COLORS[riskLevel(rate)];
}
