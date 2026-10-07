import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LanguageSettings from './LanguageSettings';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// Język szkoleń (D-133): „Automatycznie (język przeglądarki)” albo język z listy; zapis od razu, optymistycznie z cofnięciem przy błędzie.
describe('LanguageSettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    push.mockClear();
  });

  it('grupa „Język szkoleń”; wybór języka zapisuje wyłącznie contentLocale; „Automatycznie” zapisuje null; fokus zostaje', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    render(<LanguageSettings initialLocale={null} />);
    expect(screen.getByRole('group', { name: 'Język szkoleń' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Automatycznie (język przeglądarki)' })).toBeChecked();

    const english = screen.getByRole('radio', { name: 'English' });
    english.focus();
    fireEvent.click(english);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Zapisano.'));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/users/me/preferences', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ contentLocale: 'en' }) }));
    expect(english).toBeChecked();
    expect(english).toHaveFocus();

    fireEvent.click(screen.getByRole('radio', { name: 'Automatycznie (język przeglądarki)' }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/users/me/preferences', expect.objectContaining({ body: JSON.stringify({ contentLocale: null }) })));
  });

  it('błąd zapisu cofa wybór do zapisanego z komunikatem; 401 - logowanie', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    render(<LanguageSettings initialLocale="pl" />);
    fireEvent.click(screen.getByRole('radio', { name: 'English' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nie udało się zapisać ustawienia.'));
    expect(screen.getByRole('radio', { name: 'Polski' })).toBeChecked();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    fireEvent.click(screen.getByRole('radio', { name: 'English' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
  });
});
