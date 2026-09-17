import Link from 'next/link';

interface NavItem {
  label: string;
  href: string;
  active: boolean;
}

// Tylko /dashboard jest zbudowany w tym zadaniu - reszta to nieaktywne
// placeholdery odzwierciedlające moduły MVP z CLAUDE.md, żeby struktura
// nawigacji była kompletna, ale nie sugerowała nieistniejących ekranów.
const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', active: true },
  { label: 'Kursy', href: '#', active: false },
  { label: 'Kampanie phishingowe', href: '#', active: false },
  { label: 'Zgłoszenia', href: '#', active: false },
  { label: 'Ustawienia', href: '#', active: false },
];

export default function Sidebar() {
  return (
    <aside className="w-64 shrink-0 bg-slate-900 p-6 text-white">
      <p className="mb-8 text-lg font-semibold">CyberSzkoło</p>
      <nav className="space-y-1">
        {NAV_ITEMS.map((item) =>
          item.active ? (
            <Link
              key={item.label}
              href={item.href}
              className="block rounded bg-slate-800 px-3 py-2 text-sm font-medium"
            >
              {item.label}
            </Link>
          ) : (
            <span
              key={item.label}
              title="Wkrótce"
              className="block cursor-not-allowed rounded px-3 py-2 text-sm text-slate-500"
            >
              {item.label}
            </span>
          ),
        )}
      </nav>
    </aside>
  );
}
