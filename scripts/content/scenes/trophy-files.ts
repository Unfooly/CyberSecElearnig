/**
 * Nazwy plików trofeów (B-155). Tajne trofea idą do public/achievements pod nazwą z hashem treści: bez niej grafikę zdobytego tajnego
 * osiągnięcia dałoby się podejrzeć po zgadnięciu nazwy (spoiler). Łącznik, nie kropka: nazwa ikony w API i web to [a-z0-9-].
 * Nazwy z hashem są też w mapie SECRET_ICON_FILES (apps/api/src/gamification/achievement-texts.ts) - zgodność pilnuje achievement-texts.spec.ts.
 */
import { contentHash } from '../src/hash.js';

const SECRET_TROPHIES = new Set(['osiagniecie-ciekawski-detektyw', 'osiagniecie-off-the-record']);

export const isSecretTrophy = (name: string) => SECRET_TROPHIES.has(name);

export function outputFileName(name: string, svg: string): string {
  return isSecretTrophy(name) ? `${name}-${contentHash(Buffer.from(svg, 'utf8'))}.svg` : `${name}.svg`;
}
