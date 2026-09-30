import { describe, expect, it } from 'vitest';
import config from '../../tailwind.config';

// Kolory rang osiągnięć (D-111, D-126): rewers karty ma biały tekst na tle rangi - WCAG 1.4.3 wymaga kontrastu >= 4.5:1.
const colors = (config.theme?.extend?.colors ?? {}) as Record<string, unknown>;
const rank = colors.rank as Record<string, string>;

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('kolory rang osiągnięć (tailwind rank.*)', () => {
  it.each(['secret', 'legendary', 'milestone', 'rare'])('tło rewersu %s: biały tekst >= 4.5:1', (name) => {
    expect(contrast('#FFFFFF', rank[name])).toBeGreaterThanOrEqual(4.5);
  });

  it('rare to rodzina szafiru trofeów modułu 2: ciemne tło rewersu i akcent w kolorze trofeum (D-126)', () => {
    expect(rank.rare).toBe('#0E4E75');
    expect(rank['rare-accent']).toBe('#1F7FB8');
  });

  it('rare-accent nie nadaje się pod biały tekst (tylko elementy nietekstowe)', () => {
    expect(contrast('#FFFFFF', rank['rare-accent'])).toBeLessThan(4.5);
  });
});
