'use client';

import Link from 'next/link';
import { Role } from '@cyberszkolo/shared';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AVATAR_CHANGED_EVENT } from '@/lib/avatar-events';
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
  /** Tryb skupienia (odtwarzacz szkolenia): na wąskich ekranach ukrywa pozycje menu, zostaje logo, "Zgłoś" i avatar. Na desktopie bez zmian. */
  focusMode?: boolean;
}) {
  const pathname = usePathname();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Własny avatar pobieramy po stronie klienta (Topbar jest współdzielony
  // przez wszystkie strony), a zmianę z AvatarPickerModal łapiemy przez
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
  const visibleItems = NAV_ITEMS.filter((item) =>
    item.visibleFor ? role === undefined || item.visibleFor.includes(role) : !item.adminOnly || role === undefined || role === Role.ORG_ADMIN,
  );
  const builtHrefs = visibleItems.filter((item) => item.built).map((item) => item.href);
  // Najdłuższy pasujący prefiks wygrywa - bez tego /courses/achievements
  // podświetlałoby jednocześnie "Kursy" i "Osiągnięcia" (oba są prefiksami).
  const activeHref = builtHrefs
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-border bg-surface px-4 sm:px-10">
      <div className="flex h-full items-center gap-3 sm:gap-9">
        <Link href="/dashboard" className="shrink-0" aria-label="Unfooly - strona główna">
          <Logo variant="dark" />
        </Link>

        {/* min-w-0 + przewijanie poziome WEWNĄTRZ paska: wiele pozycji menu (rola ORG_ADMIN) nie może wypychać strony poza okno na telefonie. */}
        {focusMode && <div className="flex-1 sm:hidden" aria-hidden="true" />}
        <nav
          className={`h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap [&>*]:shrink-0 ${
            focusMode ? 'hidden sm:flex' : 'flex'
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

        {userEmail && (
          <Link href="/report" aria-label="Zgłoś podejrzany mail" className={`shrink-0 ${buttonClasses('secondary', 'sm')}`}>
            <span className="sm:hidden">Zgłoś</span>
            <span className="hidden sm:inline">Zgłoś podejrzany mail</span>
          </Link>
        )}

        {userEmail && <UserMenu userEmail={userEmail} avatarUrl={avatarUrl} initials={initialsFromEmail(userEmail)} />}
      </div>
    </header>
  );
}
