import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { headers } from 'next/headers';
import LandingClient from './LandingClient';
import TrackingLandingPage from '../page';
import { generateMetadata } from '../../layout';
import { DEFAULT_LESSON_HTML } from '@/lib/tracking';

// Język strony wg przeglądarki (D-133): Accept-Language z next/headers - w teście podstawiany.
vi.mock('next/headers', () => ({ headers: vi.fn() }));
const acceptLanguage = (value: string | null) =>
  vi.mocked(headers).mockReturnValue({ get: (name: string) => (name.toLowerCase() === 'accept-language' ? value : null) } as unknown as ReturnType<typeof headers>);
acceptLanguage('pl-PL,pl;q=0.9');
const metadata = generateMetadata();

const TOKEN = 'B'.repeat(43);
const fetchMock = vi.fn();

const lessonResponse = (html: string) => ({ ok: true, json: async () => ({ lessonHtml: html }) });

describe('strona lądowania /t/[[...token]]', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(lessonResponse('<p>Lekcja kampanii</p>'));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // Test języka zmienia nagłówek - kolejne testy zawsze z polskim, także gdy tamten przerwie się w połowie.
    acceptLanguage('pl-PL,pl;q=0.9');
  });

  it('samo wyrenderowanie strony (GET) NIE woła API - skanery linków niczego nie zaliczą; strona jest noindex', () => {
    render(<TrackingLandingPage params={{ token: [TOKEN] }} />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Weryfikacja konta' })).toBeInTheDocument();
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  // B-141: /t, /t/a/b itd. dają tę samą neutralną stronę (nie 404 aplikacji z metadanymi serwisu) i nigdy nie wołają API.
  it.each([
    ['/t', undefined],
    ['/t/a/b', ['a', 'b']],
    ['/t/<token>/dalej', [TOKEN, 'dalej']],
  ])('adres %s: neutralna strona, bez wywołania API także po czasie i po interakcji', async (_path, segments) => {
    render(<TrackingLandingPage params={{ token: segments }} />);
    expect(screen.getByRole('heading', { name: 'Weryfikacja konta' })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    fireEvent.pointerDown(window);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('D-133: język wg przeglądarki - en-US -> angielskie teksty i tytuł, de-DE -> angielskie (domyślny EN), pl-PL -> polskie', () => {
    acceptLanguage('en-US,pl;q=0.8');
    const { unmount } = render(<TrackingLandingPage params={{ token: [TOKEN] }} />);
    expect(screen.getByRole('heading', { name: 'Account verification' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('lang', 'en');
    expect(generateMetadata().title).toBe('Account verification');
    unmount();
    acceptLanguage('de-DE');
    const second = render(<TrackingLandingPage params={{ token: [TOKEN] }} />);
    expect(screen.getByRole('heading', { name: 'Account verification' })).toBeInTheDocument();
    second.unmount();
    acceptLanguage('pl-PL');
    render(<TrackingLandingPage params={{ token: [TOKEN] }} />);
    expect(screen.getByRole('heading', { name: 'Weryfikacja konta' })).toBeInTheDocument();
    expect(generateMetadata().title).toBe('Weryfikacja konta');
  });

  it('po 2,5 s widoczności strony: JEDNO wywołanie view, bez ciała i bez cookie', async () => {
    render(<LandingClient token={TOKEN} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/t/${TOKEN}/view`);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect(init.body).toBeUndefined();
  });

  it('pierwsza interakcja zalicza wejście od razu, a kolejne zdarzenia i upływ czasu nie dublują wywołania', async () => {
    render(<LandingClient token={TOKEN} />);

    await act(async () => {
      fireEvent.pointerDown(window);
      fireEvent.keyDown(window, { key: 'a' });
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('wysłanie formularza: NIE wysyła ani nie czyta wartości pól, woła submit bez ciała i pokazuje lekcję w sandboxie', async () => {
    render(<LandingClient token={TOKEN} />);
    fireEvent.change(screen.getByLabelText('Adres e-mail'), { target: { value: 'ofiara@firma.example' } });
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'SEKRET-123' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
      await vi.advanceTimersByTimeAsync(10);
    });

    const submitCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/submit'));
    expect(submitCall?.[0]).toBe(`/api/t/${TOKEN}/submit`);
    expect(submitCall?.[1].body).toBeUndefined();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/SEKRET|ofiara/);
    const frame = screen.getByTitle('Lekcja');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('srcdoc')).toContain('Lekcja kampanii');
    expect(screen.queryByLabelText('Hasło')).not.toBeInTheDocument();
  });

  it('"Anuluj" pokazuje lekcję po zaliczeniu wejścia, bez wysyłania formularza', async () => {
    render(<LandingClient token={TOKEN} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(screen.getByTitle('Lekcja').getAttribute('srcdoc')).toContain('Lekcja kampanii');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([`/api/t/${TOKEN}/view`]);
  });

  it('token o złym formacie: strona wygląda tak samo, nie woła API, a lekcja jest domyślna', async () => {
    render(<LandingClient token="zly-token" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      fireEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTitle('Lekcja').getAttribute('srcdoc')).toContain(DEFAULT_LESSON_HTML.slice(0, 40));
  });

  it('awaria sieci/limit: lekcja domyślna zamiast błędu (odwiedzający nie widzi różnicy)', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<LandingClient token={TOKEN} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(screen.getByTitle('Lekcja').getAttribute('srcdoc')).toContain('To była symulacja');
  });
});
