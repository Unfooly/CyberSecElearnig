import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHONE_LAYOUT_QUERIES } from './use-phone-layout';

// Próg telefonu w JS (usePhoneLayout, D-117) musi być tym samym co tryby telefonowe odtwarzacza w globals.css (bloki @media z
// `.player-outer`/`.player-frame`) - inaczej okienka easter egga przełączałyby się na „po jednym” przy innym ekranie niż odtwarzacz na
// układ telefonu.
describe('PHONE_LAYOUT_QUERIES', () => {
  it('te same zapytania co tryby telefonowe odtwarzacza (@media z .player-outer/.player-frame) w globals.css', () => {
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    const playerFrameQueries = [...css.matchAll(/@media ([^{]+)\{\s*\.player-outer/g)].map((match) => match[1].trim());
    expect([...playerFrameQueries].sort()).toEqual([...PHONE_LAYOUT_QUERIES].sort());
  });
});
