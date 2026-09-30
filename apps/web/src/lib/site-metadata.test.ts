import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { OG_IMAGE, SITE_DESCRIPTION, SITE_TITLE, socialMetadata } from './site-metadata';

// Layout ładuje fonty przez next/font (działa tylko w kompilatorze Next) - w teście wystarczą nazwy zmiennych CSS.
vi.mock('next/font/google', () => ({
  Plus_Jakarta_Sans: () => ({ variable: '--font-jakarta' }),
  Courier_Prime: () => ({ variable: '--font-typewriter' }),
}));

// Wspólny podgląd linku serwisu (D-126, B-110): jedna grafika, zero danych kursów w meta.
const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('socialMetadata', () => {
  it('domyślnie: tytuł i opis serwisu, grafika 1200×630, karta summary_large_image', () => {
    const meta = socialMetadata();
    expect(meta.openGraph).toMatchObject({ type: 'website', siteName: 'Unfooly', locale: 'pl_PL', title: SITE_TITLE, description: SITE_DESCRIPTION });
    expect(meta.openGraph?.images).toEqual([{ url: '/og/og-unfooly.png', width: 1200, height: 630, alt: OG_IMAGE.alt }]);
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', title: SITE_TITLE, description: SITE_DESCRIPTION, images: ['/og/og-unfooly.png'] });
    expect(meta.openGraph).not.toHaveProperty('url');
  });

  it('strona publiczna podaje własny tytuł, opis i adres; grafika zostaje wspólna', () => {
    const meta = socialMetadata({ title: 'Tytuł', description: 'Opis', url: '/' });
    expect(meta.openGraph).toMatchObject({ title: 'Tytuł', description: 'Opis', url: '/' });
    expect(meta.twitter).toMatchObject({ title: 'Tytuł', description: 'Opis', images: [OG_IMAGE.url] });
  });
});

describe('metadane layoutu (domyślne dla logowania, rejestracji i stron za logowaniem)', () => {
  it('layout ma metadataBase i wspólną kartę podglądu - adres grafiki bezwzględny względem adresu serwisu', async () => {
    const { metadata } = await import('../app/layout');
    expect(metadata.metadataBase).toBeInstanceOf(URL);
    const images = (metadata.openGraph?.images ?? []) as { url: string }[];
    expect(images[0].url).toBe(OG_IMAGE.url);
    expect(metadata.openGraph).toMatchObject({ title: SITE_TITLE, description: SITE_DESCRIPTION, siteName: 'Unfooly' });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', images: [OG_IMAGE.url] });
    // Tak Next składa adres z metadataBase (produkcja: SITE_URL=https://unfooly.com).
    expect(new URL(images[0].url, 'https://unfooly.com').toString()).toBe('https://unfooly.com/og/og-unfooly.png');
  });
});

describe('plik grafiki og:image', () => {
  it('PNG istnieje w public/ i ma 1200×630 (nagłówek IHDR)', () => {
    const png = readFileSync(join(web, 'public', 'og', 'og-unfooly.png'));
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([OG_IMAGE.width, OG_IMAGE.height]);
    // Rozsądny rozmiar dla botów podglądu (część komunikatorów pomija duże obrazy).
    expect(png.length).toBeLessThan(300_000);
  });
});

describe('strony, które NIE mogą mieć karty podglądu z danymi', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
    });

  // Strony kursów nie wystawiają własnych metadanych z danymi kursu - dziedziczą domyślne z layoutu (D-126).
  it('w src/app/courses nie ma generateMetadata ani eksportu metadata (w żadnej formie)', () => {
    const exported = /export\s+(async\s+)?function\s+generateMetadata|export\s+(const|let|var)\s+(metadata|generateMetadata)\b|export\s*\{[^}]*\b(metadata|generateMetadata)\b/;
    const offenders = files(join(web, 'src', 'app', 'courses')).filter((file) => exported.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  // Pozostałe strony za logowaniem mają najwyżej statyczny tytuł - bez metadanych liczonych z danych klienta.
  it.each(['dashboard', 'reports', 'report', 'account', 'onboarding'])('w src/app/%s nie ma generateMetadata', (dir) => {
    const dynamic = /\bgenerateMetadata\b/;
    expect(files(join(web, 'src', 'app', dir)).filter((file) => dynamic.test(readFileSync(file, 'utf8')))).toEqual([]);
  });

  // Strona lądowania symulacji phishingowej: bez marki serwisu w meta (inaczej podgląd linku zdradza ćwiczenie).
  it('/t/[token] zeruje opis i kartę podglądu odziedziczone z layoutu', async () => {
    const { metadata } = await import('../app/t/[token]/page');
    expect(metadata.description).toBeNull();
    expect(metadata.openGraph).toBeNull();
    expect(metadata.twitter).toBeNull();
    expect(JSON.stringify(metadata)).not.toMatch(/unfooly|phishing|symulac/i);
  });
});
