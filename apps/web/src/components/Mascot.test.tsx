import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { MASCOT_POSES as CONTENT_POSES } from '@cyberszkolo/content';
import Mascot, { MASCOT_POSES } from './Mascot';
import MascotSays from './MascotSays';

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

describe('MascotSays (maskotka i dymek jako jedna jednostka)', () => {
  it('pokazuje maskotkę i dymek z tekstem bloku w jednym kontenerze', () => {
    render(<MascotSays pose="pointing" text="Sprawdź dokładnie każdy znak. To ważne. Zwróć uwagę na zero." />);
    const unit = screen.getByTestId('mascot-says');
    expect(unit).toContainElement(screen.getByAltText('Maskotka Unfooly wskazuje'));
    expect(unit).toContainElement(screen.getByText('Sprawdź dokładnie każdy znak. To ważne. Zwróć uwagę na zero.'));
  });

  it('dymek ma ogonek (dekoracyjny, ukryty przed czytnikami ekranu)', () => {
    const { container } = render(<MascotSays pose="greeting" text="Cześć!" />);
    expect(container.querySelector('span[aria-hidden="true"]')).not.toBeNull();
  });

  it('bez tekstu pokazuje samą maskotkę, bez dymka', () => {
    const { container } = render(<MascotSays pose="cheer" />);
    expect(screen.getByAltText('Maskotka Unfooly się cieszy')).toBeInTheDocument();
    expect(container.querySelector('p')).toBeNull();
  });

  it('długi tekst (3-4 zdania) jest w całości w dymku', () => {
    const text = 'Pierwsze zdanie jest o adresie. Drugie zdanie dotyczy domeny nadawcy. Trzecie ostrzega przed presją czasu. Czwarte radzi zgłosić wiadomość.';
    render(<MascotSays pose="thinking" text={text} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('tekst z treści jest wstawiany jako tekst (bez HTML)', () => {
    const { container } = render(<MascotSays pose="warning" text={'<img src=x onerror=alert(1)>'} />);
    expect(container.querySelectorAll('img')).toHaveLength(1); // wyłącznie maskotka
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
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

  // hotfix fix/mascot-viewbox: rysunek każdej pozy sięga do y≈-30 (uszy), ale viewBox zaczynał się od "0 0 260
  // 260" - obcinał je wszystkie. Zmierzone getBBox: zakres treści x 27..245, y -30..216 dla każdej pozy. min-y
  // musi zejść przynajmniej do -30, inaczej nowa/zmieniona poza znowu wraca z ciętymi uszami.
  it('viewBox każdej pozy zaczyna się od min-y <= -30 (uszy nie są cięte)', () => {
    for (const pose of MASCOT_POSES) {
      const file = `fooli-${pose}.svg`;
      const svg = readFileSync(join(dir, file), 'utf8');
      const match = svg.match(/viewBox="(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)"/);
      expect(match, file).not.toBeNull();
      const minY = Number(match![2]);
      expect(minY, file).toBeLessThanOrEqual(-30);
    }
  });
});
