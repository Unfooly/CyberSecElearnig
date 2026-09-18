import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AvatarPickerModal from './AvatarPickerModal';
import { AVATAR_CHANGED_EVENT } from '@/lib/avatar-events';

describe('AvatarPickerModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renderuje siatkę 8 presetów i zaznacza aktualnie wybrany', () => {
    render(<AvatarPickerModal currentAvatarUrl="fox" onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'fox' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'owl' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('button', { name: /^(fox|owl|wolf|eagle|bear|shield|robot|ninja)$/ })).toHaveLength(8);
  });

  it('woła PATCH /api/users/me/avatar z wybranym presetem po kliknięciu "Zapisz"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarUrl: 'wolf' }) });
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn();

    render(<AvatarPickerModal currentAvatarUrl={null} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole('button', { name: 'wolf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/users/me/avatar',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ avatarUrl: 'wolf' }) }),
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('wolf'));
  });

  it('po udanym zapisie rozgłasza zdarzenie zmiany avatara (Topbar odświeża się od razu)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarUrl: 'wolf' }) }));
    const listener = vi.fn();
    window.addEventListener(AVATAR_CHANGED_EVENT, listener);

    render(<AvatarPickerModal currentAvatarUrl={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'wolf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toBe('wolf');
    window.removeEventListener(AVATAR_CHANGED_EVENT, listener);
  });

  it('NIE rozgłasza zdarzenia, gdy zapis się nie powiódł', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'błąd' }) }));
    const listener = vi.fn();
    window.addEventListener(AVATAR_CHANGED_EVENT, listener);

    render(<AvatarPickerModal currentAvatarUrl="fox" onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    await screen.findByRole('alert');
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(AVATAR_CHANGED_EVENT, listener);
  });

  it('pokazuje komunikat błędu z API i NIE zamyka modala, gdy zapis się nie powiedzie', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Coś poszło nie tak' }) }),
    );
    const onSaved = vi.fn();

    render(<AvatarPickerModal currentAvatarUrl="fox" onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Coś poszło nie tak');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('woła onClose po kliknięciu "Anuluj", bez wywoływania API', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();

    render(<AvatarPickerModal currentAvatarUrl="fox" onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }));

    expect(onClose).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('woła onClose po naciśnięciu Escape', () => {
    const onClose = vi.fn();
    render(<AvatarPickerModal currentAvatarUrl="fox" onClose={onClose} onSaved={vi.fn()} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });
});
