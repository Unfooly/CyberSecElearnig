import { describe, expect, it } from 'vitest';
import { lintSvg } from './svg-lint.js';

const CLEAN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <use href="#biurko" />
  <image href="data:image/png;base64,iVBORw0KGgo=" x="0" y="0" width="10" height="10" />
  <rect width="10" height="10" fill="red" />
</svg>`;

describe('lintSvg', () => {
  it('czysty SVG (fragmenty, data: URI, brak aktywnej treści): brak naruszeń', () => {
    expect(lintSvg(CLEAN)).toEqual([]);
  });

  it('CSS w SVG (animacje scen, D-084): keyframes i url(#...) OK; @import i zewnętrzny url(...) to naruszenie', () => {
    const anim = `<svg id="static"><style>.a{animation:a 1s infinite}@keyframes a{50%{opacity:.2}}#static:target *{animation:none!important}</style><rect fill="url(#g)"/></svg>`;
    expect(lintSvg(anim)).toEqual([]);
    const rules = (svg: string) => lintSvg(svg).map((v) => v.rule);
    expect(rules(`<svg><style>@import "https://evil.example/a.css";</style></svg>`)).toContain('css-at-rule');
    expect(rules(`<svg><style>@font-face{font-family:x}</style></svg>`)).toContain('css-at-rule');
    expect(rules(`<svg><style>rect{fill:url(https://evil.example/x.svg#p)}</style></svg>`)).toContain('css-url');
    expect(rules(`<svg><rect style="fill:url( '//evil.example/x' )"/></svg>`)).toContain('css-url');
    expect(rules(`<svg><rect fill="url(x.svg#g)"/></svg>`)).toContain('css-url');
    // Obejścia czarnej listy (security review): escape'y CSS, komentarz XML rozcinający słowo, funkcje ładujące bez url(.
    expect(rules(`<svg><style>rect{fill:\\75rl(https://evil.example/x)}</style></svg>`)).toContain('css-escape');
    expect(rules(`<svg><style>@\\69mport "https://evil.example/a.css";</style></svg>`)).toContain('css-escape');
    expect(rules(`<svg><style>@im<!---->port "https://evil.example/a.css";</style></svg>`)).toContain('css-comment');
    expect(rules(`<svg><style>rect{background:image-set("https://evil.example/x.png" 1x)}</style></svg>`)).toContain('css-loader');
    expect(rules(`<svg><style>rect{fill:url(#ok)}` )).toEqual([]);
  });

  it('<script>: naruszenie', () => {
    const violations = lintSvg(`<svg><script>alert(1)</script></svg>`);
    expect(violations.map((v) => v.rule)).toContain('script');
  });

  it('atrybut onload=/onclick=: naruszenie', () => {
    expect(lintSvg(`<svg onload="alert(1)"></svg>`).map((v) => v.rule)).toContain('event-handler');
    expect(lintSvg(`<svg><rect onclick="alert(1)"/></svg>`).map((v) => v.rule)).toContain('event-handler');
  });

  it('<foreignObject>: naruszenie', () => {
    expect(lintSvg(`<svg><foreignObject><div>x</div></foreignObject></svg>`).map((v) => v.rule)).toContain('foreign-object');
  });

  it.each(['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'java\tscript:alert(1)', 'j\u0000avascript:alert(1)'])(
    'adres javascript: w atrybucie (także z obejściem przez biały/sterujący znak): "%s"',
    (href) => {
      expect(lintSvg(`<svg><a href="${href}"></a></svg>`).map((v) => v.rule)).toContain('javascript-scheme');
    },
  );

  it.each(['http://evil.example/sprite.svg#x', 'https://evil.example/x.svg#y', '//evil.example/x.svg#z'])(
    '<use href> na zewnętrzny host: naruszenie ("%s")',
    (href) => {
      expect(lintSvg(`<svg><use href="${href}" /></svg>`).map((v) => v.rule)).toContain('use-external-href');
    },
  );

  it('<use xlink:href> na zewnętrzny host: naruszenie (starszy zapis atrybutu)', () => {
    expect(lintSvg(`<svg><use xlink:href="https://evil.example/x.svg#y" /></svg>`).map((v) => v.rule)).toContain('use-external-href');
  });

  it('<use href="lokalny" xlink:href="zewnętrzny"> na TYM SAMYM tagu: naruszenie (oba atrybuty muszą być sprawdzone, nie tylko pierwszy)', () => {
    // Poprawny SVG bez żadnej obfuskacji: starsze przeglądarki/narzędzia honorują xlink:href jako zapasowy adres. Sprawdzenie tylko
    // pierwszego dopasowania na tagu przepuściłoby zewnętrzny host schowany w drugim atrybucie.
    expect(lintSvg(`<svg><use href="#lokalny-fragment" xlink:href="https://evil.example/x.svg" /></svg>`).map((v) => v.rule)).toContain('use-external-href');
    expect(lintSvg(`<svg><use xlink:href="https://evil.example/x.svg" href="#lokalny-fragment" /></svg>`).map((v) => v.rule)).toContain('use-external-href');
  });

  it('<image href="lokalny" xlink:href="zewnętrzny"> na tym samym tagu: naruszenie', () => {
    expect(lintSvg(`<svg><image href="#x" xlink:href="https://evil.example/pixel.png" /></svg>`).map((v) => v.rule)).toContain('image-external-href');
  });

  it('<use href="#lokalny-fragment">: OK (bez zewnętrznego hosta)', () => {
    expect(lintSvg(`<svg><use href="#lokalny-fragment" /></svg>`)).toEqual([]);
  });

  it('<image href> na zewnętrzny host: naruszenie', () => {
    expect(lintSvg(`<svg><image href="https://evil.example/pixel.png" /></svg>`).map((v) => v.rule)).toContain('image-external-href');
  });

  it('<image href> jako data: URI: OK (bez sieci)', () => {
    expect(lintSvg(`<svg><image href="data:image/png;base64,iVBORw0KGgo=" /></svg>`)).toEqual([]);
  });

  it('kilka naruszeń naraz: wszystkie zgłoszone', () => {
    const svg = `<svg onload="x()"><script>y()</script><use href="https://evil.example/x.svg" /></svg>`;
    const rules = lintSvg(svg).map((v) => v.rule);
    expect(rules).toEqual(expect.arrayContaining(['event-handler', 'script', 'use-external-href']));
    expect(rules.length).toBeGreaterThanOrEqual(3);
  });

  it('puste wejście: brak naruszeń (pusty plik zostaje odrzucony gdzie indziej, nie tu)', () => {
    expect(lintSvg('')).toEqual([]);
  });

  // Trzy obejścia znalezione w przeglądzie bezpieczeństwa (PR 3, commit 5): regresja, żeby nie wróciły.
  describe('obejścia (regresja)', () => {
    it.each(['&#106;avascript:alert(1)', '&#x6a;avascript:alert(1)', '&#X6A;avascript:alert(1)', '&#106avascript:alert(1)'])(
      'schemat javascript: ukryty numeryczną encją znaku (dziesiętną, szesnastkową, bez średnika też): "%s"',
      (href) => {
        expect(lintSvg(`<svg><a href="${href}"></a></svg>`).map((v) => v.rule)).toContain('javascript-scheme');
      },
    );

    it('<script> z prefiksem przestrzeni nazw: naruszenie', () => {
      const svg = `<svg xmlns:x="http://www.w3.org/2000/svg"><x:script>alert(1)</x:script></svg>`;
      expect(lintSvg(svg).map((v) => v.rule)).toContain('script');
    });

    it('<foreignObject> z prefiksem przestrzeni nazw: naruszenie', () => {
      const svg = `<svg xmlns:x="http://www.w3.org/2000/svg"><x:foreignObject><div>x</div></x:foreignObject></svg>`;
      expect(lintSvg(svg).map((v) => v.rule)).toContain('foreign-object');
    });

    it('<use href> z prefiksem przestrzeni nazw, zewnętrzny host: naruszenie', () => {
      const svg = `<svg xmlns:x="http://www.w3.org/2000/svg"><x:use href="https://evil.example/x.svg" xmlns:x="http://www.w3.org/2000/svg" /></svg>`;
      expect(lintSvg(svg).map((v) => v.rule)).toContain('use-external-href');
    });

    it('<image href> z prefiksem przestrzeni nazw, zewnętrzny host: naruszenie', () => {
      const svg = `<svg><x:image href="https://evil.example/pixel.png" xmlns:x="http://www.w3.org/2000/svg" /></svg>`;
      expect(lintSvg(svg).map((v) => v.rule)).toContain('image-external-href');
    });

    it('encja numeryczna w tekście, która NIE tworzy schematu javascript: nie daje fałszywego naruszenia javascript-scheme', () => {
      // "&#65;" to litera "A" - dekodowanie encji samo w sobie nie ma tworzyć naruszeń, tylko odsłaniać ukryte "javascript:".
      expect(lintSvg(`<svg><title>Cena: 10&#65;</title></svg>`).map((v) => v.rule)).not.toContain('javascript-scheme');
    });

    it('encja poza zakresem Unicode (spreparowany plik): nie rzuca, zwraca listę naruszeń jak zwykle', () => {
      expect(() => lintSvg(`<svg><a href="&#99999999999;avascript:alert(1)"></a></svg>`)).not.toThrow();
      expect(lintSvg(`<svg><a href="&#99999999999;avascript:alert(1)"></a></svg>`)).toEqual([]);
    });
  });
});
