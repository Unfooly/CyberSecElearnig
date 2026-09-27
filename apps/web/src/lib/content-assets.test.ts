import { describe, it, expect } from 'vitest';
import { audioPathSchema, imagePathSchema } from '@cyberszkolo/content';
import { LOCAL_CONTENT_BASE, contentAssetBase, contentAssetUrl, withStaticFragment } from './content-assets';

describe('withStaticFragment (reduced-motion: animacje scen SVG zatrzymane, D-084)', () => {
  const svg = 'https://content.example.com/assets/m/scenes/biuro.1a2b3c4d.svg';
  it('przy reduced-motion dopisuje #static do SVG', () => {
    expect(withStaticFragment(svg, true)).toBe(`${svg}#static`);
    expect(withStaticFragment('/dev/module-assets/scenes/A.SVG', true)).toBe('/dev/module-assets/scenes/A.SVG#static');
  });
  it('bez preferencji, dla innych formatów, null i adresu z fragmentem - bez zmian', () => {
    expect(withStaticFragment(svg, false)).toBe(svg);
    expect(withStaticFragment('https://content.example.com/a.png', true)).toBe('https://content.example.com/a.png');
    expect(withStaticFragment(null, true)).toBeNull();
    expect(withStaticFragment(`${svg}#static`, true)).toBe(`${svg}#static`);
  });
});

describe('contentAssetBase', () => {
  it('bez CONTENT_BASE_URL albo z niepoprawną wartością: lokalny katalog /content', () => {
    for (const raw of [undefined, '', '   ', '*', 'https://*.example.com', 'ftp://example.com', 'javascript:alert(1)', 'https://a.com;script-src', 'http://example.com']) {
      expect(contentAssetBase(raw)).toBe(LOCAL_CONTENT_BASE);
    }
  });

  it('https: origin, opcjonalny prefiks ścieżki bez końcowego "/"', () => {
    expect(contentAssetBase('https://content.example.com')).toBe('https://content.example.com');
    expect(contentAssetBase('https://content.example.com/')).toBe('https://content.example.com');
    expect(contentAssetBase('https://cdn.example.com/moduly/v1/')).toBe('https://cdn.example.com/moduly/v1');
  });

  it('prefiks ze znakami specjalnymi jest odrzucany (zostaje sam origin), zapytanie i fragment znikają', () => {
    expect(contentAssetBase('https://cdn.example.com/a b/c')).toBe('https://cdn.example.com');
    expect(contentAssetBase('https://cdn.example.com/x?y=1#z')).toBe('https://cdn.example.com/x');
  });

  it('http tylko dla localhost w developmencie', () => {
    expect(contentAssetBase('http://localhost:9000', false)).toBe(LOCAL_CONTENT_BASE);
    expect(contentAssetBase('http://localhost:9000', true)).toBe('http://localhost:9000');
  });
});

describe('contentAssetUrl', () => {
  const base = 'https://content.example.com';

  it('składa bazę i ścieżkę względną', () => {
    expect(contentAssetUrl(base, 'img/scena.png', 'image')).toBe('https://content.example.com/img/scena.png');
    expect(contentAssetUrl(`${base}/`, 'audio/a.mp3', 'audio')).toBe('https://content.example.com/audio/a.mp3');
    expect(contentAssetUrl(LOCAL_CONTENT_BASE, 'audio/a.MP3', 'audio')).toBe('/content/audio/a.MP3');
  });

  const evil = [
    'https://evil.test/a.png',
    '//evil.test/a.png',
    '/etc/a.png',
    '../a.png',
    'a/../b.png',
    'javascript:alert(1).png',
    'a\\b.png',
    'a b.png',
    'a.png?x=1',
    'a.png#x',
    'a%2e%2e/b.png',
    'data:image/png;base64,AAAA.png',
    '',
    'bezrozszerzenia',
    '.png',
    'x/'.repeat(200) + 'a.png',
  ];

  it.each(evil)('odrzuca ścieżkę %p (null zamiast adresu)', (path) => {
    expect(contentAssetUrl(base, path, 'image')).toBeNull();
  });

  it('odrzuca nie-teksty i rozszerzenie niezgodne z rodzajem zasobu', () => {
    expect(contentAssetUrl(base, undefined, 'image')).toBeNull();
    expect(contentAssetUrl(base, null, 'audio')).toBeNull();
    expect(contentAssetUrl(base, 42 as unknown as string, 'audio')).toBeNull();
    expect(contentAssetUrl(base, 'a.mp3', 'image')).toBeNull();
    expect(contentAssetUrl(base, 'a.png', 'audio')).toBeNull();
    expect(contentAssetUrl(base, 'a.wav', 'audio')).toBeNull();
  });

  // Zgodność ze schematem treści: klient akceptuje dokładnie to, co przepuszcza walidacja modułu (packages/content).
  it.each([...evil, 'img/scena.png', 'a.svg', 'x/y/z.jpeg', 'a-b_c.webp', 'audio/hint1.mp3', 'audio/a.mp3', 'A.PNG', '1.avif'])(
    'zgodność z imagePathSchema/audioPathSchema dla %p',
    (path) => {
      expect(contentAssetUrl(base, path, 'image') !== null).toBe(imagePathSchema.safeParse(path).success);
      expect(contentAssetUrl(base, path, 'audio') !== null).toBe(audioPathSchema.safeParse(path).success);
    },
  );
});
