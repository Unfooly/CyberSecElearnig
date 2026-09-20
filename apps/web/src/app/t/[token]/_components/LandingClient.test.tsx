import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import LandingClient from './LandingClient';
import TrackingLandingPage, { metadata } from '../page';
import { DEFAULT_LESSON_HTML } from '@/lib/tracking';

const TOKEN = 'B'.repeat(43);
const fetchMock = vi.fn();

const lessonResponse = (html: string) => ({ ok: true, json: async () => ({ lessonHtml: html }) });

describe('strona lądowania /t/[token]', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(lessonResponse('<p>Lekcja kampanii</p>'));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('samo wyrenderowanie strony (GET) NIE woła API - skanery linków niczego nie zaliczą; strona jest noindex', () => {
    render(<TrackingLandingPage params={{ token: TOKEN }} />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Weryfikacja konta' })).toBeInTheDocument();
    expect(metadata.robots).toEqual({ index: false, follow: false });
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
