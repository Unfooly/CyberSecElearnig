import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SimpleMarkdown } from './simple-markdown';

// Wąski podzbiór markdown (pogrubienie, listy, akapity) BEZ HTML i BEZ linków: `<b>` i `[x](y)` w treści muszą wyjść na ekranie
// dosłownie (jako tekst), nigdy jako znacznik/link - React nie parsuje stringów jako HTML (bez dangerouslySetInnerHTML), więc to
// głównie test na to, że renderer sam nie próbuje interpretować tych składni.
describe('SimpleMarkdown: wąski podzbiór (pogrubienie, listy, akapity), bez HTML i linków', () => {
  it('surowy znacznik HTML i składnia linku markdown wychodzą jako dosłowny tekst', () => {
    render(<SimpleMarkdown text="Uwaga: <b>ważne</b> i [kliknij](https://evil.example)." />);
    expect(screen.getByText('Uwaga: <b>ważne</b> i [kliknij](https://evil.example).')).toBeInTheDocument();
    expect(document.querySelector('b')).not.toBeInTheDocument();
    expect(document.querySelector('a')).not.toBeInTheDocument();
  });

  it('**pogrubienie** trafia do <strong>, reszta zostaje zwykłym tekstem', () => {
    render(<SimpleMarkdown text="To jest **ważne** słowo." />);
    const strong = screen.getByText('ważne');
    expect(strong.tagName).toBe('STRONG');
    expect(screen.getByText(/To jest/)).toBeInTheDocument();
  });

  it('`kod` trafia do <code>, a znacznik HTML wewnątrz kodu wychodzi dosłownie (nie jako <b>)', () => {
    render(<SimpleMarkdown text="Domena to `bankwektor.pl`, nie `<b>zly.pl</b>`." />);
    const code = screen.getByText('bankwektor.pl');
    expect(code.tagName).toBe('CODE');
    expect(screen.getByText('<b>zly.pl</b>').tagName).toBe('CODE');
    expect(document.querySelector('b')).not.toBeInTheDocument();
  });

  it('blok, którego WSZYSTKIE linie zaczynają się od "- ", staje się listą <ul><li>', () => {
    render(<SimpleMarkdown text={'Zasady:\n\n- pierwsza\n- druga'} />);
    expect(screen.getByText('Zasady:')).toBeInTheDocument();
    const list = screen.getByRole('list');
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['pierwsza', 'druga']);
    expect(list.tagName).toBe('UL');
  });

  it('blok mieszany (zwykła linia + linia listy) zostaje akapitem, nie listą', () => {
    render(<SimpleMarkdown text={'Zasady:\n- pierwsza'} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByText(/Zasady:/)).toBeInTheDocument();
    expect(screen.getByText(/- pierwsza/)).toBeInTheDocument();
  });

  it('blok, którego WSZYSTKIE linie zaczynają się od "N. ", staje się listą <ol><li> (numerację nadaje <ol>, nie cyfry z treści)', () => {
    render(<SimpleMarkdown text={'1. **Pierwsza** rzecz\n2. Druga rzecz\n3. Trzecia rzecz'} />);
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Pierwsza rzecz', 'Druga rzecz', 'Trzecia rzecz']);
    expect(screen.getByText('Pierwsza').tagName).toBe('STRONG');
  });

  it('blok mieszany list wypunktowanej i numerowanej zostaje akapitem, nie listą', () => {
    render(<SimpleMarkdown text={'1. pierwsza\n- druga'} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('pusta linia rozdziela akapity', () => {
    render(<SimpleMarkdown text={'Pierwszy akapit.\n\nDrugi akapit.'} />);
    expect(screen.getByText('Pierwszy akapit.')).toBeInTheDocument();
    expect(screen.getByText('Drugi akapit.')).toBeInTheDocument();
  });
});
