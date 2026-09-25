import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { Role } from '@cyberszkolo/shared';
import Topbar from './Topbar';
import { AVATAR_CHANGED_EVENT } from '@/lib/avatar-events';

const usePathnameMock = vi.fn();
const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
  // Topbar renderuje UserMenu (wylogowanie), które korzysta z routera.
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

describe('Topbar', () => {
  it('renderuje linki do /dashboard, /dashboard/users, /courses i /courses/achievements jako aktywne pozycje', () => {
    usePathnameMock.mockReturnValue('/dashboard');
    render(<Topbar userEmail="jan@example.test" />);

    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: 'Zespół' })).toHaveAttribute('href', '/dashboard/users');
    expect(screen.getByRole('link', { name: 'Kursy' })).toHaveAttribute('href', '/courses');
    expect(screen.getByRole('link', { name: 'Osiągnięcia' })).toHaveAttribute('href', '/courses/achievements');
  });

  it.each([Role.EMPLOYEE, Role.DEPARTMENT_MANAGER, Role.ORG_ADMIN])('rola %s widzi przycisk "Zgłoś podejrzany mail" prowadzący do /report', (role) => {
    usePathnameMock.mockReturnValue('/courses');
    render(<Topbar userEmail="jan@example.test" role={role} />);

    expect(screen.getByRole('link', { name: 'Zgłoś podejrzany mail' })).toHaveAttribute('href', '/report');
  });

  describe('układ wąski (telefon) i tryb skupienia', () => {
    it('skrócona etykieta "Zgłoś" na telefonie nie zmienia nazwy dostępnej linku', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);

      const link = screen.getByRole('link', { name: 'Zgłoś podejrzany mail' });
      expect(link).toHaveAttribute('aria-label', 'Zgłoś podejrzany mail');
      expect(link).toHaveTextContent('Zgłoś');
    });

    it('poniżej lg pasek menu jest ukryty (hamburger zajmuje jego miejsce - patrz opisy niżej), od lg wraca w pasku', () => {
      usePathnameMock.mockReturnValue('/courses');
      const { container } = render(<Topbar userEmail="jan@example.test" role={Role.ORG_ADMIN} />);

      // Dwa <nav> w drzewie od tego PR-u (pasek desktopowy + lista w panelu mobilnym) - pierwszy w DOM to zawsze
      // pasek desktopowy (panel renderuje się PO nim); rozróżnia je też overflow-x-auto (tylko pasek) niżej.
      const nav = container.querySelector('nav') as HTMLElement;
      expect(nav.className).toMatch(/\bhidden\b/);
      expect(nav.className).toMatch(/lg:flex/);
      expect(nav.className).toMatch(/overflow-x-auto/);
      expect(nav.className).toMatch(/min-w-0/);
    });

    it('grupa "Zgłoś"/avatar/hamburger ma ml-auto (bez tego, gdy <nav> jest ukryty poniżej lg, nic nie pcha jej do prawej krawędzi) i hamburger jest jej ostatnim dzieckiem', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);

      const hamburger = screen.getByRole('button', { name: 'Otwórz menu' });
      const group = hamburger.parentElement as HTMLElement;
      expect(group.className.split(' ')).toContain('ml-auto');
      expect(group.lastElementChild).toBe(hamburger);
    });

    it('focusMode (odtwarzacz): na wąskich ekranach menu jest ukryte, zostaje logo, "Zgłoś" i avatar; od sm menu wraca', () => {
      usePathnameMock.mockReturnValue('/courses/abc');
      const { container } = render(<Topbar userEmail="jan@example.test" role={Role.ORG_ADMIN} focusMode />);

      const nav = container.querySelector('nav') as HTMLElement;
      expect(nav.className).toMatch(/\bhidden\b/);
      expect(nav.className).toMatch(/sm:flex/);
      expect(screen.getByRole('link', { name: 'Unfooly - strona główna' })).toBeInTheDocument();
      // Bez hamburgera (focusMode) grupa to tylko "Zgłoś" + avatar - ml-auto musi pchać do prawej krawędzi też
      // wtedy, nie tylko gdy hamburger jest jej ostatnim dzieckiem (patrz test wyżej).
      const group = screen.getByRole('link', { name: 'Zgłoś podejrzany mail' }).parentElement as HTMLElement;
      expect(group.className.split(' ')).toContain('ml-auto');
      expect(screen.queryByRole('button', { name: 'Otwórz menu' })).not.toBeInTheDocument();
    });

    it('adres e-mail jest wyłącznie w menu użytkownika, w całości (nic się nie ucina); kopia w panelu mobilnym jest aria-hidden, dopóki panel zamknięty', () => {
      usePathnameMock.mockReturnValue('/courses');
      const email = 'bardzo.dlugi.adres.uzytkownika@bardzo-dluga-domena-firmy.example.test';
      render(<Topbar userEmail={email} role={Role.EMPLOYEE} />);

      // Panel mobilny renderuje się od razu (animacja wjazdu/wyjazdu wymaga trwałego montowania), więc ma WŁASNĄ
      // kopię adresu - ale panel jest aria-hidden, dopóki go nikt nie otworzy, więc czytnik/użytkownik jej nie widzi.
      const dialog = screen.getByRole('dialog', { hidden: true });
      expect(dialog).toHaveAttribute('aria-hidden', 'true');
      expect(within(dialog).getByText(email)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Menu użytkownika' }));
      expect(within(screen.getByRole('menu')).getByText(email).className).toMatch(/break-all/);
    });
  });

  describe('panel mobilny (hamburger)', () => {
    function openDrawer() {
      fireEvent.click(screen.getByRole('button', { name: 'Otwórz menu' }));
    }

    it('hamburger renderuje się, aria-expanded=false, otwiera panel (aria-expanded=true, dialog przestaje być aria-hidden, ikona zmienia się na X/"Zamknij menu")', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);

      const hamburger = screen.getByRole('button', { name: 'Otwórz menu' });
      expect(hamburger).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('aria-hidden', 'true');

      fireEvent.click(hamburger);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-hidden', 'false');
      expect(screen.getByRole('button', { name: 'Zamknij menu' })).toHaveAttribute('aria-expanded', 'true');
    });

    it('filtr ról w panelu jest identyczny jak w pasku desktopowym: EMPLOYEE nie widzi pozycji adminOnly', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);
      openDrawer();

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('link', { name: 'Kursy' })).toBeInTheDocument();
      expect(within(dialog).queryByRole('link', { name: 'Zespół' })).not.toBeInTheDocument();
      expect(within(dialog).queryByRole('link', { name: 'Kampanie phishingowe' })).not.toBeInTheDocument();
    });

    it('panel ma NAV_ITEMS widoczne dla roli, separator, "Zgłoś podejrzany mail", "Ustawienia konta", e-mail i "Wyloguj" - w tej kolejności', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.ORG_ADMIN} />);
      openDrawer();

      const dialog = screen.getByRole('dialog');
      const labels = [...dialog.querySelectorAll('a, button')].map((el) => el.textContent);
      const dashboardIndex = labels.findIndex((label) => label?.includes('Dashboard'));
      const reportIndex = labels.findIndex((label) => label?.includes('Zgłoś podejrzany mail'));
      const settingsIndex = labels.findIndex((label) => label?.includes('Ustawienia konta'));
      const logoutIndex = labels.findIndex((label) => label?.includes('Wyloguj'));
      expect(dashboardIndex).toBeGreaterThanOrEqual(0);
      expect(reportIndex).toBeGreaterThan(dashboardIndex);
      expect(settingsIndex).toBeGreaterThan(reportIndex);
      expect(logoutIndex).toBeGreaterThan(settingsIndex);
      expect(within(dialog).getByText('jan@example.test')).toHaveClass('break-all');
    });

    it('zamyka się przyciskiem hamburgera (teraz "Zamknij menu"), fokus wraca na ten sam przycisk', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);
      openDrawer();

      fireEvent.click(screen.getByRole('button', { name: 'Zamknij menu' }));

      expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByRole('button', { name: 'Otwórz menu' })).toHaveFocus();
    });

    it('zamyka się kliknięciem w tło', () => {
      usePathnameMock.mockReturnValue('/courses');
      const { container } = render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);
      openDrawer();

      const backdrop = container.querySelector('[aria-hidden="true"].fixed.top-16') as HTMLElement;
      fireEvent.click(backdrop);

      expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('aria-hidden', 'true');
    });

    it('zamyka się klawiszem Escape', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);
      openDrawer();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('aria-hidden', 'true');
    });

    it('zamyka się kliknięciem w dowolny link wewnątrz (np. "Kursy")', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);
      openDrawer();

      fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Kursy' }));

      expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('aria-hidden', 'true');
    });

    it('zamyka się przy zmianie ścieżki (np. nawigacja przyciskiem "wstecz" przeglądarki w trakcie otwarcia)', () => {
      usePathnameMock.mockReturnValue('/courses');
      const { rerender } = render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);
      openDrawer();
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-hidden', 'false');

      usePathnameMock.mockReturnValue('/dashboard');
      rerender(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);

      expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('aria-hidden', 'true');
    });

    it('blokuje przewijanie body, dopóki panel jest otwarty', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);
      openDrawer();
      expect(document.body.style.overflow).toBe('hidden');

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(document.body.style.overflow).toBe('');
    });

    // Pętla fokusu (code review PR #39, punkt 2): hamburger jest teraz POZA panelem (rodzeństwo headera), ale
    // zostaje jedynym przyciskiem zamknięcia w pasku - użytkownik klawiatury ma się do niego dostać przez Tab, nie
    // tylko przez Escape. Pełny cykl: [hamburger, ...elementy drawera], zawijany w obie strony.
    it('trap fokusu: pętla obejmuje hamburger - Tab z ostatniego elementu drawera wraca na hamburger, Shift+Tab z hamburgera wraca na ostatni element drawera', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);
      openDrawer();

      const hamburger = screen.getByRole('button', { name: 'Zamknij menu' });
      const dialog = screen.getByRole('dialog');
      const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
      const last = focusable[focusable.length - 1];

      last.focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(hamburger).toHaveFocus();

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(last).toHaveFocus();
    });

    it('trap fokusu: Tab z hamburgera wchodzi w pierwszy element drawera; Shift+Tab z pierwszego elementu drawera wraca na hamburger', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);
      openDrawer();

      const hamburger = screen.getByRole('button', { name: 'Zamknij menu' });
      const dialog = screen.getByRole('dialog');
      const first = dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')[0];

      hamburger.focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(first).toHaveFocus();

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(hamburger).toHaveFocus();
    });

    it('trap fokusu: pozycja ŚRODKOWA pętli (nie hamburger, nie pierwszy/ostatni element drawera) też przesuwa się o ±1', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);
      openDrawer();

      const dialog = screen.getByRole('dialog');
      const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
      // EMPLOYEE: Kursy, Osiągnięcia, Zgłoś podejrzany mail, Ustawienia konta, Wyloguj - "Osiągnięcia" (indeks 1) jest
      // ŚRODKOWĄ pozycją całej pętli [hamburger, Kursy, Osiągnięcia, ...], nie brzegiem, którego dotyczą inne testy.
      const middle = focusable[1];
      const before = focusable[0];
      const after = focusable[2];

      middle.focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(after).toHaveFocus();

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(middle).toHaveFocus();

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(before).toHaveFocus();
    });

    it('trap fokusu: gdy fokus jest CAŁKOWICIE poza pętlą (hamburger + drawer), Tab wciąga go na hamburger, Shift+Tab na ostatni element drawera', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);
      openDrawer();

      const hamburger = screen.getByRole('button', { name: 'Zamknij menu' });
      const dialog = screen.getByRole('dialog');
      const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
      const last = focusable[focusable.length - 1];

      // document.body samo z siebie nie jest fokusowalne (brak tabindex) - .focus() na nim jest no-opem w jsdom,
      // więc do symulacji "fokus poza pętlą" trzeba realnie fokusowalnego, ale spoza Topbara, elementu. try/finally:
      // sprzątanie MUSI się wykonać nawet gdy któraś asercja padnie - inaczej bezimienny <button> zostaje w body na
      // kolejne testy w pliku (RTL czyści tylko własne kontenery renderu, nie ręcznie dodane węzły).
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      try {
        outside.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(hamburger).toHaveFocus();

        outside.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(last).toHaveFocus();
      } finally {
        outside.remove();
      }
    });

    it('zamyka się przy przejściu przez breakpoint lg (obrót telefonu/tabletu, zmiana rozmiaru okna) - inaczej blokada scrolla i nasłuch Tab/Escape zostałyby aktywne bez widocznego panelu', () => {
      const listeners: ((event: MediaQueryListEvent) => void)[] = [];
      const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockReturnValue({
        matches: false,
        media: '(min-width: 1024px)',
        onchange: null,
        addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.push(listener),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } as unknown as MediaQueryList);

      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);
      openDrawer();
      expect(document.body.style.overflow).toBe('hidden');

      act(() => {
        listeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));
      });

      expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('aria-hidden', 'true');
      expect(document.body.style.overflow).toBe('');
      matchMediaSpy.mockRestore();
    });

    // Drawer i dropdown UserMenu dzielą tę samą kolumnę z prawej (code review PR #39, punkt 2) - dropdown (z-50 w
    // kontekście nakładania headera) ląduje POD panelem (z-40, poza tym kontekstem), więc oba naraz otwarte
    // wyglądałyby jak zepsute menu. Jedno zamyka drugie w obie strony.
    it('otwarcie drawera zamyka otwarte menu użytkownika', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);

      fireEvent.click(screen.getByRole('button', { name: 'Menu użytkownika' }));
      expect(screen.getByRole('menu')).toBeInTheDocument();

      openDrawer();

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-hidden', 'false');
    });

    it('otwarty drawer → klik w avatar → drawer się zamyka, menu użytkownika się otwiera i ZOSTAJE otwarte (nie znika natychmiast)', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);
      openDrawer();

      const avatar = screen.getByRole('button', { name: 'Menu użytkownika' });
      // avatar.focus() PRZED klikiem: prawdziwa przeglądarka daje fokus klikniętemu <button>, fireEvent.click w
      // jsdom tego nie robi - bez tego test nie łapał realnego buga (code review PR #39, drobiazgi): drawer,
      // zamykając się, oddawał fokus na hamburger (POZA kontenerem UserMenu), co jego własny handler focusout
      // odbierał jako "wyjście fokusem poza menu" i zamykał je natychmiast po otwarciu.
      avatar.focus();
      fireEvent.click(avatar);

      expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(avatar).toHaveFocus(); // fokus zostaje na avatarze - drawer NIE oddaje go na hamburger w tym przypadku
    });

    it('focusMode: hamburger nie renderuje się w ogóle (zachowanie jak dziś - bez nowego sposobu otwarcia menu)', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} focusMode />);

      expect(screen.queryByRole('button', { name: 'Otwórz menu' })).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument();
    });

    it('bez zalogowanego użytkownika panel nie pokazuje sekcji "Zgłoś"/"Ustawienia"/"Wyloguj", ale pozycje NAV_ITEMS zostają', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail={null} />);
      openDrawer();

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('link', { name: 'Kursy' })).toBeInTheDocument();
      expect(within(dialog).queryByRole('link', { name: 'Zgłoś podejrzany mail' })).not.toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: 'Wyloguj' })).not.toBeInTheDocument();
    });
  });

  it('bez zalogowanego użytkownika nie ma przycisku zgłoszenia', () => {
    usePathnameMock.mockReturnValue('/courses');
    render(<Topbar userEmail={null} />);

    expect(screen.queryByRole('link', { name: 'Zgłoś podejrzany mail' })).not.toBeInTheDocument();
  });

  describe('nawigacja zależna od roli (UX; dostęp egzekwują middleware i API)', () => {
    const adminLabels = ['Dashboard', 'Zespół', 'Ustawienia', 'Kampanie phishingowe'];

    it('EMPLOYEE NIE widzi modułów administratora (w tym symulacji phishingowych), widzi kursy i osiągnięcia', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);

      for (const label of adminLabels) {
        expect(screen.queryByText(label)).not.toBeInTheDocument();
      }
      expect(screen.getByRole('link', { name: 'Kursy' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Osiągnięcia' })).toBeInTheDocument();
    });

    it('DEPARTMENT_MANAGER też nie widzi pozycji administratora organizacji', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.DEPARTMENT_MANAGER} />);

      expect(screen.queryByText('Kampanie phishingowe')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Zespół' })).not.toBeInTheDocument();
    });

    it('ORG_ADMIN widzi wszystko, w tym link do szablonów symulacji', () => {
      usePathnameMock.mockReturnValue('/dashboard');
      render(<Topbar userEmail="jan@example.test" role={Role.ORG_ADMIN} />);

      expect(screen.getByRole('link', { name: 'Kampanie phishingowe' })).toHaveAttribute('href', '/dashboard/phishing/campaigns');
      for (const label of ['Zespół', 'Ustawienia']) {
        expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
      }
    });
  });

  it('podświetla WYŁĄCZNIE "Zespół" na /dashboard/users, mimo że to też podścieżka /dashboard', () => {
    usePathnameMock.mockReturnValue('/dashboard/users');
    render(<Topbar userEmail="jan@example.test" />);

    expect(screen.getByRole('link', { name: 'Zespół' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^dashboard$/i })).not.toHaveAttribute('aria-current', 'page');
  });

  it('podświetla WYŁĄCZNIE "Kursy" na /courses (nie miesza z Osiągnięciami)', () => {
    usePathnameMock.mockReturnValue('/courses');
    render(<Topbar userEmail="jan@example.test" />);

    expect(screen.getByRole('link', { name: 'Kursy' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Osiągnięcia' })).not.toHaveAttribute('aria-current', 'page');
  });

  it('podświetla WYŁĄCZNIE "Osiągnięcia" na /courses/achievements, mimo że to też podścieżka /courses', () => {
    usePathnameMock.mockReturnValue('/courses/achievements');
    render(<Topbar userEmail="jan@example.test" />);

    expect(screen.getByRole('link', { name: 'Osiągnięcia' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Kursy' })).not.toHaveAttribute('aria-current', 'page');
  });

  it('podświetla "Kursy" też na podstronie odtwarzacza (/courses/:id)', () => {
    usePathnameMock.mockReturnValue('/courses/course-1');
    render(<Topbar userEmail="jan@example.test" />);

    expect(screen.getByRole('link', { name: 'Kursy' })).toHaveAttribute('aria-current', 'page');
  });

  it('pokazuje wybrany avatar zamiast inicjałów, gdy użytkownik go ustawił', async () => {
    usePathnameMock.mockReturnValue('/courses');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarUrl: 'fox' }) }));
    render(<Topbar userEmail="adrian.pozniak@example.test" />);

    expect(await screen.findByRole('img', { name: 'Twój avatar' })).toBeInTheDocument();
    expect(screen.queryByText('AP')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('po zapisaniu nowego avatara (zdarzenie) od razu podmienia inicjały, bez przeładowania', async () => {
    usePathnameMock.mockReturnValue('/courses');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarUrl: null }) }));
    render(<Topbar userEmail="adrian.pozniak@example.test" />);
    expect(await screen.findByText('AP')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent(AVATAR_CHANGED_EVENT, { detail: 'fox' }));
    });

    expect(screen.getByRole('img', { name: 'Twój avatar' })).toBeInTheDocument();
    expect(screen.queryByText('AP')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('przy błędzie pobrania avatara zostają inicjały', async () => {
    usePathnameMock.mockReturnValue('/courses');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    render(<Topbar userEmail="adrian.pozniak@example.test" />);

    expect(await screen.findByText('AP')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('klik w avatar otwiera menu użytkownika z pozycją "Wyloguj"', () => {
    usePathnameMock.mockReturnValue('/courses');
    render(<Topbar userEmail="jan.kowalski@example.test" role={Role.EMPLOYEE} />);

    fireEvent.click(screen.getByRole('button', { name: 'Menu użytkownika' }));

    expect(screen.getByRole('menuitem', { name: 'Wyloguj' })).toBeInTheDocument();
  });

  it('pokazuje inicjały z e-maila użytkownika', () => {
    usePathnameMock.mockReturnValue('/courses');
    render(<Topbar userEmail="jan.kowalski@example.test" />);

    expect(screen.getByText('JK')).toBeInTheDocument();
  });

  it('nie renderuje sekcji użytkownika, gdy userEmail jest null', () => {
    usePathnameMock.mockReturnValue('/courses');
    render(<Topbar userEmail={null} />);

    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  describe('skrzynka zgłoszeń (/reports)', () => {
    it.each([Role.ORG_ADMIN, Role.DEPARTMENT_MANAGER])('rola %s widzi aktywną pozycję "Zgłoszenia" prowadzącą do /reports', (role) => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={role} />);

      expect(screen.getByRole('link', { name: 'Zgłoszenia' })).toHaveAttribute('href', '/reports');
    });

    it('EMPLOYEE nie widzi pozycji "Zgłoszenia" (ma tylko przycisk zgłoszenia podejrzanego maila)', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);

      expect(screen.queryByRole('link', { name: 'Zgłoszenia' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Zgłoś podejrzany mail' })).toBeInTheDocument();
    });

    it('pozycja jest aktywna (aria-current) na /reports i podstronie zgłoszenia', () => {
      usePathnameMock.mockReturnValue('/reports/abc123');
      render(<Topbar userEmail="jan@example.test" role={Role.ORG_ADMIN} />);

      expect(screen.getByRole('link', { name: 'Zgłoszenia' })).toHaveAttribute('aria-current', 'page');
    });

    it('bez znanej roli (strony administratora) pozycja jest widoczna', () => {
      usePathnameMock.mockReturnValue('/dashboard');
      render(<Topbar userEmail="jan@example.test" />);

      expect(screen.getByRole('link', { name: 'Zgłoszenia' })).toBeInTheDocument();
    });
  });
});
