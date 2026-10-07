import { describe, expect, it } from 'vitest';
import { composeScene, validateScene } from './compose.js';
import { PROPS } from './props.js';

const base = { width: 1000, height: 500, items: [] as any[] };

describe('composeScene', () => {
  it('liczy hotspot w procentach z pozycji, rozmiaru klocka, skali i marginesu', () => {
    const res = composeScene({ ...base, items: [{ id: 'kubek', prop: 'mug', x: 100, y: 50, scale: 2, pad: 0, hotspot: true }] });
    const m = PROPS.mug({});
    expect(res.hotspots).toEqual([{ id: 'kubek', x: 10, y: 10, w: (m.w * 2) / 10, h: (m.h * 2) / 5 }]);
  });

  it('hotspot z części klocka (karteczka na monitorze) i partHotspots', () => {
    const res = composeScene({
      ...base,
      items: [{ id: 'monitor', prop: 'monitor', x: 0, y: 100, pad: 0, hotspot: true, partHotspots: { sticky: 'karteczka' }, params: { sticky: ['x'] } }],
    });
    expect(res.hotspots.map(h => h.id)).toEqual(['monitor', 'karteczka']);
    const k = res.hotspots[1];
    expect(k.x).toBeCloseTo(36, 0);
    expect(k.y).toBeCloseTo(14, 0);
  });

  it('jednorazowa animacja stempla (D-090): reguły a-stamp tylko w scenie, która jej używa, przed regułami zatrzymującymi', () => {
    const plain = composeScene({ ...base, items: [{ id: 'teczka', prop: 'caseFolderClosed', x: 0, y: 0 }] });
    expect(plain.svg).not.toContain('a-stamp');
    const drop = composeScene({ ...base, items: [{ id: 'teczka', prop: 'caseFolderClosed', x: 0, y: 0, params: { stampDrop: true } }] });
    expect(drop.svg).toContain('<g class="a-stamp">');
    expect(drop.svg.indexOf('@keyframes a-stamp')).toBeGreaterThan(-1);
    // W pierwszym <style>, razem z regułami zatrzymującymi (reduced-motion, #static) - te mają !important.
    expect(drop.svg.indexOf('@keyframes a-stamp')).toBeLessThan(drop.svg.indexOf('</style>'));
    expect(drop.svg).toContain('#static:target *{animation:none!important}');
    // Obrót stempla zostaje na zewnętrznej grupie (transform z CSS nie nadpisuje atrybutu).
    expect(drop.svg).toMatch(/<g transform="rotate\(-10 440 310\)"><g class="a-stamp">/);
  });

  it('obcina hotspot do granic sceny', () => {
    const res = composeScene({ ...base, items: [{ id: 'k', prop: 'mug', x: 990, y: 490, hotspot: true }] });
    const h = res.hotspots[0];
    expect(h.x + h.w).toBeLessThanOrEqual(100);
    expect(h.y + h.h).toBeLessThanOrEqual(100);
  });

  it('odrzuca nieznany klocek, powtórzone id i brakującą część', () => {
    expect(validateScene({ ...base, items: [{ id: 'a', prop: 'nope', x: 0, y: 0 }] })).toHaveLength(1);
    expect(() => composeScene({ ...base, items: [{ id: 'a', prop: 'mug', x: 0, y: 0 }, { id: 'a', prop: 'mug', x: 0, y: 0 }] })).toThrow(/Powtórzone/);
    expect(() => composeScene({ ...base, items: [{ id: 'a', prop: 'mug', x: 0, y: 0, hotspot: 'sticky' }] })).toThrow(/części/);
  });

  it('dwa monitory nie kolidują id clipPath', () => {
    const res = composeScene({ ...base, items: [{ id: 'm1', prop: 'monitor', x: 0, y: 0, params: { screen: 'mail' } }, { id: 'm2', prop: 'monitor', x: 500, y: 0, params: { screen: 'login' } }] });
    expect(res.svg).toContain('id="scr-m1"');
    expect(res.svg).toContain('id="scr-m2"');
    expect(res.svg).not.toContain('id="scr"');
  });

  it('SVG nie zawiera skryptów, zdarzeń ani odwołań zewnętrznych; tekst jest escapowany', () => {
    const params = { lines: ['<script>alert(1)</script>', 'a&b'] };
    const res = composeScene({ ...base, items: [{ id: 'n', prop: 'stickyNote', x: 0, y: 0, params }] });
    expect(res.svg).not.toMatch(/<script|on\w+=|href=|foreignObject|javascript:/i);
    // Klocek escapuje tekst w <text>; w gotowej scenie tekst jest konturem (D-135) - bez znaków z treści w ogóle.
    expect(PROPS.stickyNote(params).svg).toContain('&lt;script&gt;');
    expect(PROPS.stickyNote(params).svg).toContain('a&amp;b');
    expect(res.svg).not.toMatch(/<text\b|alert/);
  });

  // Pola renderowane w KONTEKŚCIE ATRYBUTU (fill/stroke), nie <text>: ucieczka z cudzysłowu atrybutu wstrzyknęłaby
  // dodatkowy atrybut/zdarzenie (np. `onmouseover=`), inny wektor niż zawartość <text> wyżej - osobny test, bo esc()
  // dla tych pól był kiedyś pominięty (color/binders/background.wall/background.floor).
  it('pola w kontekście atrybutu (color/binders/tło) są escapowane', () => {
    const injected = '"onmouseover="alert(1)';
    const sticky = composeScene({ ...base, items: [{ id: 'n', prop: 'stickyNote', x: 0, y: 0, params: { color: injected } }] });
    const mug = composeScene({ ...base, items: [{ id: 'm', prop: 'mug', x: 0, y: 0, params: { color: injected } }] });
    const shelf = composeScene({ ...base, items: [{ id: 's', prop: 'shelf', x: 0, y: 0, params: { binders: [injected] } }] });
    const bg = composeScene({ ...base, background: { wall: injected, floor: injected } });
    for (const res of [sticky, mug, shelf, bg]) {
      expect(res.svg).not.toContain(injected); // niezescapowany ciąg (z prawdziwym ") nigdzie nie występuje - nie da się wyjść z atrybutu
      expect(res.svg).toContain('&quot;onmouseover=&quot;alert(1)'); // ten sam tekst, ale bezpiecznie zescapowany
    }
  });

  it('każdy klocek renderuje się z domyślnymi parametrami', () => {
    for (const [name, fn] of Object.entries(PROPS)) {
      const out = fn({});
      expect(out.w, name).toBeGreaterThan(0);
      expect(out.h, name).toBeGreaterThan(0);
      expect(out.svg, name).not.toContain('undefined');
    }
  });
});
