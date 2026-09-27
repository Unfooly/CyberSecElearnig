import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FilmSection, { FILM_POSTER, FILM_SRC } from './FilmSection';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

// Film na stronie głównej (D-091): wyciszony, pętla, inline; autoplay tylko bez reduced-motion (wtedy zawsze przycisk pauzy - WCAG
// 2.2.2), inaczej plakat + „Odtwórz film”; opis tekstowy pod filmem (WCAG 1.2.1).
describe('FilmSection', () => {
  const original = window.matchMedia;
  let play: ReturnType<typeof vi.fn>;
  let pause: ReturnType<typeof vi.fn>;
  let listeners: ((event: { matches: boolean }) => void)[];
  let reduce: boolean;

  beforeEach(() => {
    play = vi.fn(() => Promise.resolve());
    pause = vi.fn();
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(play as unknown as () => Promise<void>);
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(pause as unknown as () => void);
    listeners = [];
    reduce = false;
    window.matchMedia = ((query: string) => ({
      ...original(query),
      get matches() {
        return reduce && query.includes('prefers-reduced-motion: reduce');
      },
      addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => listeners.push(listener),
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original;
    vi.restoreAllMocks();
  });
  const video = () => screen.getByTestId('landing-film') as HTMLVideoElement;

  it('bez reduced-motion: własny plik z public/marketing, plakat, wyciszony, pętla, inline, bez atrybutu autoplay; gra sam i ma przycisk pauzy', async () => {
    render(<FilmSection />);
    expect(video().getAttribute('src')).toBe(FILM_SRC);
    expect(video().getAttribute('poster')).toBe(FILM_POSTER);
    expect(video().muted).toBe(true);
    expect(video()).toHaveAttribute('loop');
    expect(video()).toHaveAttribute('playsinline');
    expect(video()).not.toHaveAttribute('autoplay');
    // Przed wynikiem autostartu - bez migającego dużego przycisku.
    expect(screen.queryByRole('button', { name: 'Odtwórz film' })).not.toBeInTheDocument();
    expect(play).toHaveBeenCalled();
    fireEvent.play(video());
    const toggle = await screen.findByRole('button', { name: 'Wstrzymaj film' });
    // Atrapa play() nie zmienia `paused` w jsdom - stan "gra" ustawiamy ręcznie.
    Object.defineProperty(video(), 'paused', { value: false, configurable: true });
    fireEvent.click(toggle);
    expect(pause).toHaveBeenCalled();
    fireEvent.pause(video());
    expect(screen.getByRole('button', { name: 'Wznów film' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Odtwórz film' })).not.toBeInTheDocument();
  });

  it('podpis, CTA do rejestracji i tekstowy opis filmu powiązany z nagraniem', () => {
    render(<FilmSection />);
    expect(screen.getByRole('heading', { level: 2, name: 'Tak wygląda jedno kliknięcie.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Załóż konto firmy/ })).toHaveAttribute('href', '/register');
    expect(video()).toHaveAttribute('aria-describedby', 'film-description-text');
    expect(screen.getByText('Opis filmu')).toBeInTheDocument();
    expect(document.getElementById('film-description')).toHaveTextContent('bankwektor-weryfikacja.pl');
  });

  it('reduced-motion: bez autoodtwarzania; „Odtwórz film” startuje odtwarzanie z kontrolkami, znika i przenosi fokus na film', async () => {
    reduce = true;
    render(<FilmSection />);
    expect(play).not.toHaveBeenCalled();
    const button = await screen.findByRole('button', { name: 'Odtwórz film' });
    fireEvent.click(button);
    expect(play).toHaveBeenCalledTimes(1);
    expect(video().controls).toBe(true);
    expect(video()).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Odtwórz film' })).not.toBeInTheDocument();
  });

  it('przeglądarka odrzuca autostart: zostaje duży przycisk „Odtwórz film”', async () => {
    play.mockImplementation(() => Promise.reject(new Error('NotAllowedError')));
    render(<FilmSection />);
    expect(await screen.findByRole('button', { name: 'Odtwórz film' })).toBeInTheDocument();
  });

  it('reduced-motion włączone w trakcie: autostartujący film staje; po ręcznym starcie zmiana preferencji go nie zatrzymuje', async () => {
    const { unmount } = render(<FilmSection />);
    fireEvent.play(video());
    await screen.findByRole('button', { name: 'Wstrzymaj film' });
    reduce = true;
    act(() => listeners.forEach((listener) => listener({ matches: true })));
    await waitFor(() => expect(pause).toHaveBeenCalled());
    unmount();

    reduce = true;
    render(<FilmSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Odtwórz film' }));
    pause.mockClear();
    reduce = false;
    act(() => listeners.forEach((listener) => listener({ matches: false })));
    reduce = true;
    act(() => listeners.forEach((listener) => listener({ matches: true })));
    expect(pause).not.toHaveBeenCalled();
  });
});
