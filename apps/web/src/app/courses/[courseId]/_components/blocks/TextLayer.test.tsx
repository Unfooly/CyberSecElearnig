import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TextLayerItem } from '@/lib/courses-types';
import { PHONE_LAYOUT_QUERY } from '@/lib/use-phone-layout';
import TextLayer, { TEXT_LAYER_MIN_PX } from './TextLayer';

// Zasady warstwy tekstu (D-128). jsdom nie liczy layoutu (wymiary 0), więc tu pilnujemy reguł w kodzie: klasy, kolor, dolny limit
// rozmiaru; to, czy napis faktycznie mieści się w slocie i nie jest ucięty, sprawdza layout-check (m5/n5) w prawdziwej przeglądarce.
const items: TextLayerItem[] = [
  { id: 'szyld', x: 10, y: 5, w: 20, h: 6, text: 'Księgowość', style: 'sign' },
  { id: 'ekran', x: 40, y: 20, w: 30, h: 10, text: 'Logowanie\nodrzucone', style: 'screen', tone: 'light' },
  { id: 'kartka', x: 5, y: 60, w: 20, h: 10, text: 'Zadzwonić do IT', style: 'handwritten', portrait: { x: 1, y: 2, w: 50, h: 8 } },
  { id: 'podpis', x: 5, y: 80, w: 20, h: 5, text: 'Poczta' },
];

const text = (id: string) => screen.getByTestId(`text-layer-${id}`).firstElementChild as HTMLElement;

describe('TextLayer', () => {
  const originalMatchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });
  const asPhone = () => {
    window.matchMedia = ((query: string) => ({
      matches: query === PHONE_LAYOUT_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  };

  it('bez napisów nic nie renderuje', () => {
    const { container } = render(<TextLayer items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('każdy styl: font dziedziczony (bez kroju o stałej szerokości), zawijanie w slocie, bez ucinania (żadnego nowrap/truncate)', () => {
    render(<TextLayer items={items} />);
    for (const item of items) {
      const node = text(item.id);
      expect(node.className).toMatch(/whitespace-pre-line/);
      expect(node.className).not.toMatch(/font-mono|whitespace-nowrap|truncate|text-ellipsis/);
      // Słowa w całości, dopóki mieszczą się w slocie przy dolnym limicie (łamanie w środku włącza dopiero FitText, gdy się nie mieszczą).
      expect(node.style.overflowWrap).toBe('normal');
    }
    // Pismo odręczne to jedyny styl z własnym krojem.
    expect(text('kartka').className).toMatch(/font-family/);
    expect(text('szyld').className).not.toMatch(/font-family/);
    expect(text('ekran').className).not.toMatch(/font-family/);
  });

  it('kolor z treści: domyślnie ciemny tekst (jasne tło slotu), `tone: light` - biały na ciemnym tle', () => {
    render(<TextLayer items={items} />);
    expect(screen.getByTestId('text-layer-szyld')).toHaveAttribute('data-tone', 'dark');
    expect(text('szyld').className).toMatch(/text-slate-900/);
    expect(screen.getByTestId('text-layer-ekran')).toHaveAttribute('data-tone', 'light');
    expect(text('ekran').className).toMatch(/text-white/);
    expect(text('ekran').className).not.toMatch(/text-slate-900/);
  });

  it(`dolny limit rozmiaru: ${TEXT_LAYER_MIN_PX.desktop} px na desktopie, ${TEXT_LAYER_MIN_PX.phone} px na telefonie`, () => {
    // jsdom: slot ma wysokość 0, więc dopasowanie kończy na samym limicie.
    const { unmount } = render(<TextLayer items={items} />);
    for (const item of items) expect(text(item.id).style.fontSize).toBe('14px');
    unmount();

    asPhone();
    render(<TextLayer items={items} />);
    for (const item of items) expect(text(item.id).style.fontSize).toBe('15px');
  });

  it('prostokąty w % grafiki; w wariancie pionowym - prostokąt `portrait`, gdy napis go ma', () => {
    const { unmount } = render(<TextLayer items={items} />);
    expect(screen.getByTestId('text-layer-kartka')).toHaveStyle({ left: '5%', top: '60%', width: '20%', height: '10%' });
    unmount();
    render(<TextLayer items={items} portrait />);
    expect(screen.getByTestId('text-layer-kartka')).toHaveStyle({ left: '1%', top: '2%', width: '50%', height: '8%' });
    expect(screen.getByTestId('text-layer-podpis')).toHaveStyle({ left: '5%', top: '80%' });
  });

  it('warstwa nie łapie kliknięć (przedmioty sceny leżą nad nią) i znika z drzewa dostępności pod zbliżeniem', () => {
    const { rerender } = render(<TextLayer items={items} />);
    expect(screen.getByTestId('text-layer').className).toMatch(/pointer-events-none/);
    expect(screen.getByTestId('text-layer')).not.toHaveAttribute('aria-hidden');
    rerender(<TextLayer items={items} ariaHidden />);
    expect(screen.getByTestId('text-layer')).toHaveAttribute('aria-hidden', 'true');
  });
});
