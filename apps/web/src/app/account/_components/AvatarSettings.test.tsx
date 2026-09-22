import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AvatarSettings from './AvatarSettings';
import { AVATAR_CHANGED_EVENT } from '@/lib/avatar-events';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AvatarSettings (ustawienia konta)', () => {
  it('renderuje siatkę 8 presetów i zaznacza aktualnie zapisany', () => {
    render(<AvatarSettings initialAvatarUrl="owl" />);

    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'owl' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('"Zapisz" jest nieaktywny, dopóki wybór nie różni się od zapisanego', () => {
    render(<AvatarSettings initialAvatarUrl="owl" />);

    expect(screen.getByRole('button', { name: 'Zapisz' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'fox' }));
    expect(screen.getByRole('button', { name: 'Zapisz' })).toBeEnabled();
  });

  it('woła PATCH /api/users/me/avatar z wybranym presetem i potwierdza zapis', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarUrl: 'fox' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<AvatarSettings initialAvatarUrl="owl" />);

    fireEvent.click(screen.getByRole('button', { name: 'fox' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Avatar zapisany.');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/users/me/avatar',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ avatarUrl: 'fox' }) }),
    );
    // Po zapisie wybór = stan zapisany, więc nie ma czego zapisywać ponownie.
    expect(screen.getByRole('button', { name: 'Zapisz' })).toBeDisabled();
  });

  it('po udanym zapisie rozgłasza zdarzenie zmiany avatara (Topbar odświeża się od razu)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarUrl: 'wolf' }) }));
    const listener = vi.fn();
    window.addEventListener(AVATAR_CHANGED_EVENT, listener);
    render(<AvatarSettings initialAvatarUrl={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'wolf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect((listener.mock.calls[0][0] as CustomEvent<string>).detail).toBe('wolf');
    window.removeEventListener(AVATAR_CHANGED_EVENT, listener);
  });

  it('pokazuje komunikat błędu z API i NIE rozgłasza zdarzenia, gdy zapis się nie powiedzie', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Nieprawidłowy avatar.' }) }),
    );
    const listener = vi.fn();
    window.addEventListener(AVATAR_CHANGED_EVENT, listener);
    render(<AvatarSettings initialAvatarUrl={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'ninja' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nieprawidłowy avatar.');
    expect(listener).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    window.removeEventListener(AVATAR_CHANGED_EVENT, listener);
  });

  it('awaria sieci kończy się komunikatem, a nie wywróceniem ekranu', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    render(<AvatarSettings initialAvatarUrl={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'bear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
  });

  it('bez zapisanego avatara nic nie jest zaznaczone, a zapis jest zablokowany do czasu wyboru', () => {
    render(<AvatarSettings initialAvatarUrl={null} />);

    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zapisz' })).toBeDisabled();
  });

  describe('własne zdjęcie', () => {
    const png = () => new File([new Uint8Array([1, 2, 3])], 'avatar.png', { type: 'image/png' });

    function selectFile(file: File) {
      const input = screen.getByLabelText(/wgraj zdjęcie/i) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [file] } });
      return input;
    }

    it('wysyła plik jako multipart na /api/users/me/avatar/image i pokazuje potwierdzenie', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarUrl: 'upload:abc123' }) });
      vi.stubGlobal('fetch', fetchMock);
      render(<AvatarSettings initialAvatarUrl={null} />);

      selectFile(png());

      expect(await screen.findByRole('status')).toHaveTextContent('Avatar zapisany.');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/users/me/avatar/image');
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
      expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    });

    it('po wgraniu zdjęcia rozgłasza zdarzenie, więc avatar w pasku zmienia się od razu', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarUrl: 'upload:abc123' }) }));
      const listener = vi.fn();
      window.addEventListener(AVATAR_CHANGED_EVENT, listener);
      render(<AvatarSettings initialAvatarUrl={null} />);

      selectFile(png());

      await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
      expect((listener.mock.calls[0][0] as CustomEvent<string>).detail).toBe('upload:abc123');
      window.removeEventListener(AVATAR_CHANGED_EVENT, listener);
    });

    it('za duży plik jest odrzucany po stronie przeglądarki, bez wysyłania go na serwer', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      render(<AvatarSettings initialAvatarUrl={null} />);

      const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'duze.png', { type: 'image/png' });
      selectFile(big);

      expect(await screen.findByRole('alert')).toHaveTextContent('Plik jest za duży (maksymalnie 2 MB).');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('błąd z serwera pokazuje komunikat i nie zmienia avatara', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Dozwolone są pliki PNG, JPEG lub WebP.' }) }),
      );
      render(<AvatarSettings initialAvatarUrl="owl" />);

      selectFile(png());

      expect(await screen.findByRole('alert')).toHaveTextContent('Dozwolone są pliki PNG, JPEG lub WebP.');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'owl' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('przy presecie nie ma czego usuwać - przycisku usunięcia zdjęcia nie pokazujemy', () => {
      render(<AvatarSettings initialAvatarUrl="owl" />);

      expect(screen.queryByRole('button', { name: 'Usuń zdjęcie' })).not.toBeInTheDocument();
    });

    it('usunięcie zdjęcia woła DELETE, czyści avatar i chowa przycisk usuwania', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarUrl: null }) });
      vi.stubGlobal('fetch', fetchMock);
      render(<AvatarSettings initialAvatarUrl="upload:abc123" />);

      fireEvent.click(screen.getByRole('button', { name: 'Usuń zdjęcie' }));

      expect(await screen.findByRole('status')).toHaveTextContent('Avatar zapisany.');
      expect(fetchMock).toHaveBeenCalledWith('/api/users/me/avatar/image', { method: 'DELETE' });
      expect(screen.queryByRole('button', { name: 'Usuń zdjęcie' })).not.toBeInTheDocument();
    });
  });
});
