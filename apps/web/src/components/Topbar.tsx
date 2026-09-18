'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import AvatarDisplay from '@/app/courses/_components/AvatarDisplay';
import { AVATAR_CHANGED_EVENT } from '@/lib/avatar-events';

interface NavItem {
  label: string;
  href: string;
  // Zbudowane ekrany - reszta to nieaktywne placeholdery odzwierciedlające
  // moduły MVP z CLAUDE.md, żeby struktura nawigacji była kompletna, ale
  // nie sugerowała nieistniejących ekranów (patrz dawny Sidebar.tsx).
  built: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', built: true },
  { label: 'Zespół', href: '/dashboard/users', built: true },
  { label: 'Kursy', href: '/courses', built: true },
  { label: 'Osiągnięcia', href: '/courses/achievements', built: true },
  { label: 'Kampanie phishingowe', href: '#', built: false },
  { label: 'Zgłoszenia', href: '#', built: false },
];

function initialsFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  const segments = localPart.split(/[._-]+/).filter(Boolean);
  const first = segments[0]?.[0]?.toUpperCase() ?? '?';
  const second = segments[1]?.[0]?.toUpperCase() ?? '';
  return `${first}${second}`;
}

export default function Topbar({ userEmail }: { userEmail: string | null }) {
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

  const builtHrefs = NAV_ITEMS.filter((item) => item.built).map((item) => item.href);
  // Najdłuższy pasujący prefiks wygrywa - bez tego /courses/achievements
  // podświetlałoby jednocześnie "Kursy" i "Osiągnięcia" (oba są prefiksami).
  const activeHref = builtHrefs
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white px-6 py-3">
      <div className="mx-auto flex max-w-7xl items-center gap-8">
        <Link href="/courses" className="shrink-0 text-lg font-bold tracking-tight text-slate-900">
          Cyber<span className="text-emerald-600">Szkoło</span>
        </Link>

        <nav className="flex flex-1 items-center gap-6">
          {NAV_ITEMS.map((item) => {
            if (!item.built) {
              return (
                <span
                  key={item.label}
                  title="Wkrótce"
                  className="hidden cursor-not-allowed text-sm text-slate-300 md:inline"
                >
                  {item.label}
                </span>
              );
            }
            const isActive = item.href === activeHref;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`text-sm ${
                  isActive ? 'font-semibold text-slate-900' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {userEmail && (
          <div className="flex shrink-0 items-center gap-2">
            {avatarUrl ? (
              <AvatarDisplay avatarUrl={avatarUrl} size="sm" label="Twój avatar" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
                {initialsFromEmail(userEmail)}
              </span>
            )}
            <span className="hidden text-sm text-slate-600 sm:inline">{userEmail}</span>
          </div>
        )}
      </div>
    </header>
  );
}
