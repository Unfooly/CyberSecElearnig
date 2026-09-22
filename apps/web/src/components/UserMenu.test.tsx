import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UserMenu from './UserMenu';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  pushMock.mockClear();
  refreshMock.mockClear();
});

function renderMenu(avatarUrl: string | null = null) {
  return render(<UserMenu userEmail="jan.kowalski@example.test" avatarUrl={avatarUrl} initials="JK" />);
}

describe('UserMenu', () => {
  it('menu jest zamknięte, dopóki użytkownik nie kliknie avatara', () => {
    renderMenu();

    expect(screen.getByRole('button', { name: 'Menu użytkownika' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Wyloguj' })).not.toBeInTheDocument();
  });

  it('klik w avatar otwiera menu z pozycją "Wyloguj" i pełnym adresem e-mail', () => {
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Menu użytkownika' }));

    expect(screen.getByRole('button', { name: 'Menu użytkownika' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Wyloguj' })).toBeInTheDocument();
    // Adres w pasku jest ukryty na telefonie, więc w menu musi być widoczny w całości.
    expect(screen.getAllByText('jan.kowalski@example.test').length).toBeGreaterThan(0);
  });

  it('ponowny klik w avatar zamyka menu', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Menu użytkownika' });

    fireEvent.click(trigger);
    fireEvent.click(trigger);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('"Wyloguj" wysyła POST /api/auth/logout i przenosi na /login', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Menu użytkownika' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Wyloguj' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('nawet gdy żądanie wylogowania padnie, użytkownik trafia na /login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Menu użytkownika' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Wyloguj' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
  });

  it('Escape zamyka menu i oddaje fokus przyciskowi', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Menu użytkownika' });
    fireEvent.click(trigger);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('klik poza menu je zamyka', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Menu użytkownika' }));

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('wyjście fokusem poza menu (Tab) je zamyka - nie zostaje wiszący dropdown', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Menu użytkownika' });
    fireEvent.click(trigger);

    fireEvent.focusOut(screen.getByRole('menuitem', { name: 'Wyloguj' }), { relatedTarget: document.body });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('przeniesienie fokusu WEWNĄTRZ menu go nie zamyka', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Menu użytkownika' });
    fireEvent.click(trigger);
    const item = screen.getByRole('menuitem', { name: 'Wyloguj' });

    fireEvent.focusOut(trigger, { relatedTarget: item });

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('w trakcie wylogowywania przycisk jest zablokowany i pokazuje stan pośredni', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise((resolve) => {
        resolveFetch = resolve;
      })),
    );
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Menu użytkownika' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Wyloguj' }));

    const item = await screen.findByRole('menuitem', { name: 'Wylogowywanie...' });
    expect(item).toBeDisabled();
    expect(pushMock).not.toHaveBeenCalled();

    resolveFetch?.({ ok: true });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
  });

  it('pokazuje wybrany avatar zamiast inicjałów, gdy użytkownik go ustawił', () => {
    renderMenu('fox');

    expect(screen.getByRole('img', { name: 'Twój avatar' })).toBeInTheDocument();
    expect(screen.queryByText('JK')).not.toBeInTheDocument();
  });
});
