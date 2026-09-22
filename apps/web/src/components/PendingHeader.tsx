'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from '@/components/Logo';
import Button from '@/components/ui/Button';
import { useLogout } from '@/lib/use-logout';

// Uproszczony nagłówek dla admina organizacji, która czeka na weryfikację
// domeny: tylko ekrany dostępne dla PENDING (weryfikacja, ustawienia) i
// wylogowanie. Pełny Topbar prowadziłby do stron blokowanych przez API.
export default function PendingHeader() {
  const pathname = usePathname();
  // Ta sama ścieżka wylogowania co w UserMenu (Topbar) - patrz lib/use-logout.ts.
  const { logout, isLoggingOut } = useLogout();

  const link = (href: string, label: string) => (
    <Link
      href={href}
      aria-current={pathname === href ? 'page' : undefined}
      className={`text-sm font-semibold hover:underline ${pathname === href ? 'text-ink' : 'text-accent-ink'}`}
    >
      {label}
    </Link>
  );

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-6 sm:px-10">
      <Logo variant="dark" />
      <nav aria-label="Weryfikacja organizacji" className="flex items-center gap-5">
        {link('/onboarding', 'Weryfikacja domeny')}
        {link('/dashboard/settings', 'Ustawienia organizacji')}
        <Button variant="secondary" size="sm" onClick={logout} disabled={isLoggingOut}>
          Wyloguj
        </Button>
      </nav>
    </header>
  );
}
