import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { MASCOT_POSES as CONTENT_POSES } from '@cyberszkolo/content';
import Mascot, { MASCOT_POSES } from './Mascot';

describe('Mascot', () => {
  it('lista póz zgadza się ze schematem treści (packages/content)', () => {
    expect([...MASCOT_POSES]).toEqual([...CONTENT_POSES]);
  });

  it.each(MASCOT_POSES)('poza %s: obraz z własnej domeny (public/mascot) i opis dla czytników ekranu', (pose) => {
    render(<Mascot pose={pose} />);
    const image = screen.getByRole('img');
    expect(image).toHaveAttribute('src', `/mascot/fooli-${pose}.svg`);
    expect(image.getAttribute('alt')).toMatch(/Maskotka Unfooly/);
  });

  it('nigdy nie renderuje SVG inline w miejscu obrazu (tylko <img>) i nie ładuje z obcego hosta', () => {
    const { container } = render(<Mascot pose="cheer" />);
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('img')!.getAttribute('src')).toMatch(/^\/mascot\//);
  });

  it('dymek pokazuje tekst bloku', () => {
    render(<Mascot pose="greeting" text="Cześć! Zaczynamy." />);
    expect(screen.getByText('Cześć! Zaczynamy.')).toBeInTheDocument();
  });

  it('błąd ładowania pliku (brak w buildzie) daje placeholder z opisem', () => {
    render(<Mascot pose="warning" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByTestId('mascot-placeholder')).toHaveAttribute('aria-label', 'Maskotka Unfooly ostrzega');
    expect(screen.queryByRole('img', { name: /ostrzega/ })).toBe(screen.getByTestId('mascot-placeholder'));
  });

  it('nieznana poza (np. z treści) daje placeholder, bez próby ładowania pliku', () => {
    const { container } = render(<Mascot pose="../../etc/passwd" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('mascot-placeholder')).toBeInTheDocument();
  });
});

describe('źródło grafik maskotki (packages/content/mascot)', () => {
  const dir = join(__dirname, '..', '..', '..', '..', 'packages', 'content', 'mascot');

  it('każda poza ma plik SVG (inaczej w UI zostaje placeholder)', () => {
    for (const pose of MASCOT_POSES) expect(existsSync(join(dir, `fooli-${pose}.svg`)), pose).toBe(true);
  });

  it('pliki SVG maskotki nie zawierają skryptów ani odwołań zewnętrznych (ładowane przez <img>, ale i tak pilnujemy)', () => {
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.svg'))) {
      const svg = readFileSync(join(dir, file), 'utf8');
      expect(svg, file).not.toMatch(/<script|on\w+\s*=|javascript:|xlink:href\s*=\s*["']https?:|href\s*=\s*["']https?:/i);
    }
  });
});
