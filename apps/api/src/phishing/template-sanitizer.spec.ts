import {
  hasTrackingLink,
  sanitizeLessonHtml,
  sanitizeTemplateBody,
  TRACKING_LINK_PLACEHOLDER,
} from './template-sanitizer';

describe('sanitizeTemplateBody', () => {
  it('zachowuje formatowanie tekstu i jedyny dozwolony link {{trackingLink}}', () => {
    const html = '<p>Cześć <strong>Ania</strong></p><ul><li>punkt</li></ul><p><a href="{{trackingLink}}">Kliknij</a></p>';

    expect(sanitizeTemplateBody(html)).toBe(html);
  });

  it.each([
    ['link zewnętrzny', '<a href="https://evil.example.com/login">x</a>', 'x'],
    ['javascript:', '<a href="javascript:alert(1)">x</a>', 'x'],
    ['data:', '<a href="data:text/html;base64,AAAA">x</a>', 'x'],
    ['protokół względny', '<a href="//evil.example.com">x</a>', 'x'],
    ['placeholder z dopiskiem (próba dopisania adresu)', '<a href="{{trackingLink}}?next=https://evil.example.com">x</a>', 'x'],
    ['placeholder w innej wielkości liter', '<a href="{{TRACKINGLINK}}">x</a>', 'x'],
  ])('%s: link jest usuwany, tekst zostaje', (_label, html, text) => {
    const result = sanitizeTemplateBody(html);

    expect(result).not.toContain('<a');
    expect(result).not.toContain('href');
    expect(result).toContain(text);
  });

  it.each([
    '<script>alert(1)</script>',
    '<img src="https://evil.example.com/pixel.gif">',
    '<iframe src="https://evil.example.com"></iframe>',
    '<style>p{color:red}</style>',
    '<form action="https://evil.example.com"><input name="x"></form>',
    '<object data="x"></object>',
    '<embed src="x">',
    '<link rel="stylesheet" href="https://evil.example.com/x.css">',
    '<meta http-equiv="refresh" content="0;url=https://evil.example.com">',
    '<base href="https://evil.example.com/">',
  ])('usuwa niedozwolony znacznik: %s', (html) => {
    const result = sanitizeTemplateBody(`<p>tekst</p>${html}`);

    expect(result).toBe('<p>tekst</p>');
  });

  it('usuwa atrybuty zdarzeń, style i klasy (także na dozwolonych tagach)', () => {
    const result = sanitizeTemplateBody('<p onclick="x()" style="color:red" class="a" id="b">tekst</p>');

    expect(result).toBe('<p>tekst</p>');
  });

  it('na <a> zostawia tylko href (bez target, onclick, rel, title)', () => {
    const result = sanitizeTemplateBody(`<a href="${TRACKING_LINK_PLACEHOLDER}" target="_blank" onclick="x()" title="t" rel="x">l</a>`);

    expect(result).toBe('<a href="{{trackingLink}}">l</a>');
  });

  it('nie da się ominąć przez zniekształcone znaczniki i kodowanie', () => {
    const attacks = [
      '<scr<script>ipt>alert(1)</scr</script>ipt>',
      '<a href="jav&#x61;script:alert(1)">x</a>',
      '<a href="&#106;avascript:alert(1)">x</a>',
      '<a href=" javascript:alert(1)">x</a>',
      '<svg onload=alert(1)>',
      '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
      '<p title="<script>alert(1)</script>">x</p>',
    ];
    for (const attack of attacks) {
      const result = sanitizeTemplateBody(attack);
      expect(result).not.toMatch(/<script|javascript:|onload|<svg|<math|href=/i);
    }
  });

  it('hasTrackingLink: prawda tylko przy dokładnym placeholderze po sanityzacji', () => {
    expect(hasTrackingLink(sanitizeTemplateBody('<a href="{{trackingLink}}">x</a>'))).toBe(true);
    expect(hasTrackingLink(sanitizeTemplateBody('<a href="https://x.pl">x</a>'))).toBe(false);
    expect(hasTrackingLink(sanitizeTemplateBody('<p>{{trackingLink}} w tekście</p>'))).toBe(false);
    // Tekst wyglądający jak atrybut albo cały znacznik NIE jest linkiem.
    expect(hasTrackingLink(sanitizeTemplateBody('<p>href="{{trackingLink}}"</p>'))).toBe(false);
    expect(hasTrackingLink(sanitizeTemplateBody('<p>&lt;a href="{{trackingLink}}"&gt;x&lt;/a&gt;</p>'))).toBe(false);
    expect(hasTrackingLink(sanitizeTemplateBody('<p><a href="{{trackingLink}}">x</a></p>'))).toBe(true);
  });
});

describe('sanitizeLessonHtml', () => {
  it('zachowuje formatowanie, ale usuwa WSZYSTKIE linki (także placeholder) i niebezpieczne znaczniki', () => {
    const result = sanitizeLessonHtml(
      '<p>Lekcja</p><ul><li>a</li></ul><a href="{{trackingLink}}">l</a><a href="https://x.pl">m</a><script>x</script><img src="x">',
    );

    expect(result).toBe('<p>Lekcja</p><ul><li>a</li></ul><span>l</span><span>m</span>');
  });
});
