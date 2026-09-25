'use client';

import Link from 'next/link';
import { Role } from '@cyberszkolo/shared';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { LogOut, Menu, Settings, X } from 'lucide-react';
import { AVATAR_CHANGED_EVENT } from '@/lib/avatar-events';
import { useLogout } from '@/lib/use-logout';
import { buttonClasses } from './ui/Button';
import Logo from './Logo';
import UserMenu from './UserMenu';

interface NavItem {
  label: string;
  href: string;
  // Zbudowane ekrany - reszta to nieaktywne placeholdery odzwierciedlające
  // moduły MVP z CLAUDE.md, żeby struktura nawigacji była kompletna, ale
  // nie sugerowała nieistniejących ekranów (patrz dawny Sidebar.tsx).
  built: boolean;
  // Pozycja panelu administratora organizacji - ukrywana dla innych ról (EMPLOYEE nie widzi
  // modułów zarządzania, w tym symulacji phishingowych). To wyłącznie UX: dostęp egzekwują
  // middleware.ts i apps/api (RolesGuard).
  adminOnly?: boolean;
  // Widoczność dla wskazanych ról (np. skrzynka zgłoszeń: ORG_ADMIN i DEPARTMENT_MANAGER); ma pierwszeństwo przed adminOnly.
  visibleFor?: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', built: true, adminOnly: true },
  { label: 'Zespół', href: '/dashboard/users', built: true, adminOnly: true },
  { label: 'Kursy', href: '/courses', built: true },
  { label: 'Osiągnięcia', href: '/courses/achievements', built: true },
  { label: 'Ustawienia', href: '/dashboard/settings', built: true, adminOnly: true },
  { label: 'Kampanie phishingowe', href: '/dashboard/phishing/campaigns', built: true, adminOnly: true },
  { label: 'Zgłoszenia', href: '/reports', built: true, visibleFor: [Role.ORG_ADMIN, Role.DEPARTMENT_MANAGER] },
];

// Wydzielone (feat/mobile-app-shell): ta sama logika filtrowania po roli używana w pasku (lg+) i w panelu
// mobilnym (poniżej lg) - jedno miejsce prawdy, żeby oba widoki nie rozjechały się przy kolejnej zmianie ról/pozycji.
function visibleNavItems(role: Role | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) =>
    item.visibleFor ? role === undefined || item.visibleFor.includes(role) : !item.adminOnly || role === undefined || role === Role.ORG_ADMIN,
  );
}

// j.w. dla podświetlenia aktywnej pozycji - najdłuższy pasujący prefiks wygrywa (bez tego /courses/achievements
// podświetlałoby jednocześnie "Kursy" i "Osiągnięcia", oba są prefiksami).
function activeNavHref(items: NavItem[], pathname: string): string | undefined {
  const builtHrefs = items.filter((item) => item.built).map((item) => item.href);
  return builtHrefs.filter((href) => pathname === href || pathname.startsWith(`${href}/`)).sort((a, b) => b.length - a.length)[0];
}

function initialsFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  const segments = localPart.split(/[._-]+/).filter(Boolean);
  const first = segments[0]?.[0]?.toUpperCase() ?? '?';
  const second = segments[1]?.[0]?.toUpperCase() ?? '';
  return `${first}${second}`;
}

export default function Topbar({
  userEmail,
  role,
  focusMode = false,
}: {
  userEmail: string | null;
  role?: Role;
  /** Tryb skupienia (odtwarzacz szkolenia): na wąskich ekranach ukrywa pozycje menu i hamburger, zostaje logo, "Zgłoś" i avatar. Na desktopie bez zmian. */
  focusMode?: boolean;
}) {
  const pathname = usePathname();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Drawer i dropdown UserMenu dzielą tę samą kolumnę z prawej - nie mogą być otwarte naraz (dropdown, z-50 w
  // kontekście nakładania headera, i tak lądowałby POD panelem, z-40 poza tym kontekstem - code review PR #39,
  // punkt 2). UserMenu.forceClose zamyka je, gdy otwiera się drawer; onOpenChange zamyka drawer w drugą stronę.
  const drawerId = useId();
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const wasOpenRef = useRef(false);
  // Gdy drawer zamyka się, bo otworzyło się UserMenu (nie Escape/tło/link) - fokus MA zostać na avatarze (tam, gdzie
  // go realnie postawił klik w prawdziwej przeglądarce; fireEvent.click w jsdom fokusu nie przenosi, więc test tego
  // nie łapał). Bez tej flagi efekt niżej i tak oddawałby fokus na hamburger, co wychodzi POZA kontener UserMenu i
  // od razu je zamyka jego własnym handlerem focusout - code review PR #39, drobiazgi.
  const skipFocusReturnRef = useRef(false);

  // Własny avatar pobieramy po stronie klienta (Topbar jest współdzielony
  // przez wszystkie strony), a zmianę z ustawień konta łapiemy przez
  // zdarzenie - bez przeładowania strony. Błąd/brak avatara = inicjały.
  useEffect(() => {
    // Nowy użytkownik nie może widzieć avatara poprzedniego do czasu odpowiedzi.
    setAvatarUrl(null);
    if (!userEmail) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/users/me/avatar');
        if (!response?.ok) {
          return;
        }
        const data = await response.json();
        if (!cancelled && typeof data?.avatarUrl === 'string') {
          setAvatarUrl(data.avatarUrl);
        }
      } catch {
        // inicjały jako fallback
      }
    })();

    function handleChanged(event: Event) {
      const next = (event as CustomEvent<string | null>).detail;
      setAvatarUrl(typeof next === 'string' ? next : null);
    }
    window.addEventListener(AVATAR_CHANGED_EVENT, handleChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(AVATAR_CHANGED_EVENT, handleChanged);
    };
  }, [userEmail]);

  // Rola nieznana (strony administratora, do których middleware wpuszcza tylko ORG_ADMIN) = wszystkie pozycje.
  const visibleItems = visibleNavItems(role);
  const activeHref = activeNavHref(visibleItems, pathname);
  // Pierwszy ZBUDOWANY element dostaje fokus po otwarciu panelu - nie zawsze index 0 (mogłaby nim być
  // nieklikalna pozycja "Wkrótce", na której .focus() jest no-opem).
  const firstBuiltIndex = visibleItems.findIndex((item) => item.built);

  // Panel zamyka się przy zmianie ścieżki - klik w link i tak zamyka natychmiast (onClick niżej), ale to też
  // łapie nawigację, która nie idzie przez klik wewnątrz panelu (np. przycisk "wstecz" przeglądarki w trakcie otwarcia).
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Panel zamyka się też przy przejściu przez breakpoint lg (obrót telefonu/tabletu, zmiana rozmiaru okna) - inaczej
  // panel/tło dostają lg:hidden, ale drawerOpen zostaje true, więc blokada scrolla body i nasłuch Tab/Escape z efektu
  // niżej zostają aktywne na desktopie bez żadnego widocznego panelu (code review PR #39).
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    function handleChange(event: MediaQueryListEvent) {
      if (event.matches) {
        setDrawerOpen(false);
      }
    }
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  // Blokada przewijania body, Escape i trap fokusu (Tab/Shift+Tab zawinięte na granicach panelu) - tylko gdy otwarty.
  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const panel = drawerRef.current;
      if (!panel) {
        return;
      }
      // Hamburger jest teraz POZA panelem (rodzeństwo headera, nie jego dziecko - code review PR #39, punkt 1), ale
      // zostaje jedynym przyciskiem zamknięcia w pasku, więc musi być CZĘŚCIĄ pętli fokusu, nie tylko "miejscem, z
      // którego wciągamy z powrotem" - użytkownik klawiatury ma się do niego dostać w obu kierunkach Tab, nie tylko
      // przez Escape. Pełny, jawny cykl (nie tylko zawijanie na krańcach) - jsdom nie ma natywnego porządku Tab, więc
      // to jedyny sposób, żeby zachowanie było takie samo i testowalne w każdym miejscu cyklu, nie tylko na brzegach.
      // Selektor nie odfiltrowuje elementów UKRYTYCH (display:none/hidden) - dziś w panelu nie ma takich (pozycje
      // "Wkrótce" to nieinteraktywne <span>, nie <a>/<button>), więc nie ma czego pomijać. Gdyby kiedyś doszedł tu
      // link ukryty jakimś wariantem responsywnym, .focus() na nim byłoby no-opem i pętla by się zacięła w tym
      // miejscu - wcześniej chronił przed tym natywny porządek Tab przeglądarki, którego ta jawna pętla nie ma
      // (code review PR #39, drobiazgi).
      const drawerFocusable = [...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
      const cycle = hamburgerRef.current ? [hamburgerRef.current, ...drawerFocusable] : drawerFocusable;
      if (cycle.length === 0) {
        // Nie powinno się zdarzyć (hamburger zawsze istnieje, gdy panel istnieje), ale gdyby - fokus zostaje w panelu.
        event.preventDefault();
        panel.focus();
        return;
      }
      event.preventDefault();
      const activeIndex = cycle.indexOf(document.activeElement as HTMLElement);
      if (activeIndex === -1) {
        // Fokus poza calą pętlą (np. klik myszą w tło) - wciąga go z powrotem na jej brzeg, zamiast pozwolić mu
        // uciec na stronę pod spodem.
        (event.shiftKey ? cycle[cycle.length - 1] : cycle[0]).focus();
        return;
      }
      const nextIndex = event.shiftKey ? (activeIndex - 1 + cycle.length) % cycle.length : (activeIndex + 1) % cycle.length;
      cycle[nextIndex].focus();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [drawerOpen]);

  // Fokus na pierwszy link po otwarciu; po zamknięciu wraca na hamburger (nie przy pierwszym renderze - wasOpenRef
  // pilnuje, żeby to zadziałało tylko na przejściu otwarty -> zamknięty, nie na starcie strony).
  useEffect(() => {
    if (drawerOpen) {
      wasOpenRef.current = true;
      firstLinkRef.current?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      if (skipFocusReturnRef.current) {
        skipFocusReturnRef.current = false;
      } else {
        hamburgerRef.current?.focus();
      }
    }
  }, [drawerOpen]);

  const closeDrawerForUserMenu = useCallback((open: boolean) => {
    if (open) {
      skipFocusReturnRef.current = true;
      setDrawerOpen(false);
    }
  }, []);

  return (
    <>
      <header className="sticky top-0 z-40 h-16 border-b border-border bg-surface px-4 sm:px-10">
        <div className="flex h-full items-center gap-3 sm:gap-9">
          <Link href="/dashboard" className="shrink-0" aria-label="Unfooly - strona główna">
            <Logo variant="dark" />
          </Link>

          {/* min-w-0 + przewijanie poziome WEWNĄTRZ paska (od lg w górę - poniżej lg pasek zastępuje hamburger). */}
          <nav
            className={`h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap [&>*]:shrink-0 ${
              focusMode ? 'hidden sm:flex' : 'hidden lg:flex'
            }`}
          >
            {visibleItems.map((item) => {
              if (!item.built) {
                return (
                  <span
                    key={item.label}
                    className="hidden h-full cursor-default items-center gap-2 border-b-2 border-transparent px-3 font-semibold text-muted-2 md:flex"
                  >
                    {item.label}
                    <span className="rounded-full border border-border bg-paper px-[7px] py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-muted">
                      Wkrótce
                    </span>
                  </span>
                );
              }
              const isActive = item.href === activeHref;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex h-full items-center border-b-2 px-3 font-semibold ${
                    isActive ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* ml-auto zamiast polegania na flex-1 z <nav>: <nav> jest ukryty poniżej lg (albo poniżej sm w
              focusMode), więc bez tego ta grupa nie miała NICZEGO, co pchałoby ją do prawej krawędzi - lądowała
              tuż przy logo zamiast przy prawym brzegu paska. Od lg (albo sm w focusMode) <nav> ma flex-1 i tak
              zajmuje całą wolną przestrzeń przed tą grupą, więc ml-auto tam nic nie zmienia - wygląd bez zmian. */}
          <div className="ml-auto flex shrink-0 items-center gap-3 sm:gap-9">
            {userEmail && (
              <Link href="/report" aria-label="Zgłoś podejrzany mail" className={`shrink-0 ${buttonClasses('secondary', 'sm')}`}>
                <span className="sm:hidden">Zgłoś</span>
                <span className="hidden sm:inline">Zgłoś podejrzany mail</span>
              </Link>
            )}

            {userEmail && (
              <UserMenu
                userEmail={userEmail}
                avatarUrl={avatarUrl}
                initials={initialsFromEmail(userEmail)}
                forceClose={drawerOpen}
                onOpenChange={closeDrawerForUserMenu}
              />
            )}

            {/* Ostatni (najbardziej po prawej) na telefonie: logo, "Zgłoś", avatar, HAMBURGER - w tej kolejności.
                44x44 (h-11 w-11, nie h-10 w-10) - docelowy rozmiar dotykowego celu; -mr-2 przybliża go do
                prawdziwej krawędzi ekranu, nie przesuwając wizualnie samej ikony (padding wewnątrz przycisku
                zostaje wyśrodkowany). */}
            {!focusMode && (
              <button
                ref={hamburgerRef}
                type="button"
                onClick={() => setDrawerOpen((open) => !open)}
                aria-label={drawerOpen ? 'Zamknij menu' : 'Otwórz menu'}
                aria-expanded={drawerOpen}
                aria-controls={drawerId}
                className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-btn text-muted hover:bg-paper focus:outline-none focus:ring-2 focus:ring-accent-soft lg:hidden"
              >
                {drawerOpen ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Tło i panel są RODZEŃSTWEM headera, nie jego dziećmi: header ma WŁASNY kontekst nakładania (sticky +
          z-index), więc jego potomkowie z jawnym z-index (np. to tło) i tak biją niepozycjonowane/z-auto
          rodzeństwo (hamburger, UserMenu) WEWNĄTRZ tego kontekstu, niezależnie od z-index samego headera - kod
          review PR #39: hamburger/avatar były niedostępne pod otwartym tłem. Dodatkowo tło i panel zaczynają się
          POD paskiem (top-16, nie inset-0/inset-y-0) - pasek (z logo/Zgłoś/avatar/hamburgerem) zostaje w pełni
          widoczny i klikalny nad nimi przez cały czas, więc hamburger jest niezawodnym, zawsze osiągalnym
          przyciskiem zamknięcia (bez potrzeby drugiego przycisku "X" w środku panelu). */}
      {!focusMode && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
            className={`fixed inset-x-0 top-16 bottom-0 z-30 bg-black/40 transition-opacity duration-200 motion-reduce:transition-none lg:hidden ${
              drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          />
          <div
            id={drawerId}
            ref={drawerRef}
            role="dialog"
            // Celowo BEZ aria-modal="true" (code review PR #39, drobiazgi): pętla fokusu obejmuje hamburger, który
            // jest POZA tym elementem (rodzeństwo headera) - aria-modal każe czytnikom ekranu (np. VoiceOver)
            // traktować wszystko poza dialogiem jako nieaktywne, co zrobiłoby hamburger nieosiągalnym w ich własnej
            // nawigacji, sprzecznie z tym, co faktycznie robi nasza pętla Tab. To panel typu disclosure (jak
            // UserMenu), nie prawdziwy modal - `aria-expanded`/`aria-controls` na hamburgerze już to opisują.
            aria-label="Menu"
            aria-hidden={!drawerOpen}
            tabIndex={-1}
            className={`fixed right-0 top-16 bottom-0 z-40 flex w-full max-w-[320px] flex-col overflow-y-auto bg-surface shadow-card transition-transform duration-200 motion-reduce:transition-none lg:hidden ${
              drawerOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
              {visibleItems.map((item, index) => {
                // Celowo widoczne tu ZAWSZE (w pasku desktopowym "Wkrótce" jest ukryte poniżej md, bo pasek ma mało
                // miejsca) - pełna lista modułów MVP w rozwijanym panelu jest czytelniejsza niż ucinanie jej.
                if (!item.built) {
                  return (
                    <span key={item.label} className="flex items-center gap-2 rounded-btn px-3 py-2 font-semibold text-muted-2">
                      {item.label}
                      <span className="rounded-full border border-border bg-paper px-[7px] py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-muted">
                        Wkrótce
                      </span>
                    </span>
                  );
                }
                const isActive = item.href === activeHref;
                return (
                  <Link
                    key={item.label}
                    ref={index === firstBuiltIndex ? firstLinkRef : undefined}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setDrawerOpen(false)}
                    tabIndex={drawerOpen ? undefined : -1}
                    className={`rounded-btn px-3 py-2 font-semibold ${isActive ? 'bg-accent-soft text-ink' : 'text-muted hover:bg-paper hover:text-ink'}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            {userEmail && (
              <DrawerUserSection userEmail={userEmail} drawerOpen={drawerOpen} onNavigate={() => setDrawerOpen(false)} />
            )}
          </div>
        </>
      )}
    </>
  );
}

// Wydzielone z Topbar: useLogout() (a więc i useRouter()) ma się wywoływać WYŁĄCZNIE, gdy ta sekcja faktycznie się
// montuje (userEmail prawdziwe) - dokładnie tak jak już robi to UserMenu. Wywołanie useLogout() wprost w Topbar,
// niezależnie od userEmail, wymagałoby useRouter w KAŻDYM teście renderującym Topbar (także z userEmail: null) -
// złapane przez testy stron (dashboard/achievements/users), które mockują next/navigation bez useRouter.
function DrawerUserSection({
  userEmail,
  drawerOpen,
  onNavigate,
}: {
  userEmail: string;
  drawerOpen: boolean;
  onNavigate: () => void;
}) {
  const { logout, isLoggingOut } = useLogout();

  // Jak UserMenu: NAJPIERW await logout() (użytkownik widzi "Wylogowywanie..." w OTWARTYM panelu przez czas
  // żądania), dopiero potem zamknięcie - odwrotna kolejność chowała stan ładowania w zamkniętym, aria-hidden
  // panelu i dawała brak jakiejkolwiek informacji zwrotnej na czas fetch()a (code review PR #39). Panel i tak
  // zamknie się sam przez efekt zmiany pathname (logout() kończy się router.push('/login')), ale onNavigate()
  // tutaj też - na wypadek błędu sieci, po którym useLogout i tak przechodzi na /login (patrz jego komentarz).
  async function handleLogout() {
    await logout();
    onNavigate();
  }

  return (
    <div className="shrink-0 border-t border-border p-3">
      <Link
        href="/report"
        onClick={onNavigate}
        tabIndex={drawerOpen ? undefined : -1}
        className="block rounded-btn px-3 py-2 font-semibold text-muted hover:bg-paper hover:text-ink"
      >
        Zgłoś podejrzany mail
      </Link>
      <Link
        href="/account"
        onClick={onNavigate}
        tabIndex={drawerOpen ? undefined : -1}
        className="flex items-center gap-2 rounded-btn px-3 py-2 font-semibold text-muted hover:bg-paper hover:text-ink"
      >
        <Settings size={16} strokeWidth={2} aria-hidden="true" />
        Ustawienia konta
      </Link>
      <p className="break-all px-3 pb-1 pt-2 text-[13px] font-semibold text-muted">{userEmail}</p>
      <button
        type="button"
        onClick={handleLogout}
        disabled={isLoggingOut}
        tabIndex={drawerOpen ? undefined : -1}
        className="flex w-full items-center gap-2 rounded-btn px-3 py-2 text-left font-semibold text-muted hover:bg-paper hover:text-ink disabled:cursor-default disabled:opacity-50"
      >
        <LogOut size={16} strokeWidth={2} aria-hidden="true" />
        {isLoggingOut ? 'Wylogowywanie...' : 'Wyloguj'}
      </button>
    </div>
  );
}
