'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  label: string;
  href: string;
  // Zbudowane ekrany - reszta to nieaktywne placeholdery odzwierciedlające
  // moduły MVP z CLAUDE.md, żeby struktura nawigacji była kompletna, ale
  // nie sugerowała nieistniejących ekranów.
  built: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', built: true },
  { label: 'Kursy', href: '/courses', built: true },
  { label: 'Kampanie phishingowe', href: '#', built: false },
  { label: 'Zgłoszenia', href: '#', built: false },
  { label: 'Ustawienia', href: '#', built: false },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 shrink-0 bg-slate-900 p-6 text-white">
      <p className="mb-8 text-lg font-semibold">CyberSzkoło</p>
      <nav className="space-y-1">
        {NAV_ITEMS.map((item) => {
          if (!item.built) {
            return (
              <span
                key={item.label}
                title="Wkrótce"
                className="block cursor-not-allowed rounded px-3 py-2 text-sm text-slate-500"
              >
                {item.label}
              </span>
            );
          }

          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`block rounded px-3 py-2 text-sm font-medium ${
                isActive ? 'bg-slate-800' : 'hover:bg-slate-800/60'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
