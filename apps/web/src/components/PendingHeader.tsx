'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Logo from '@/components/Logo';
import Button from '@/components/ui/Button';

// Uproszczony nagłówek dla admina organizacji, która czeka na weryfikację
// domeny: tylko ekrany dostępne dla PENDING (weryfikacja, ustawienia) i
// wylogowanie. Pełny Topbar prowadziłby do stron blokowanych przez API.
export default function PendingHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function logout() {
    setIsLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Awaria sieci: i tak przechodzimy na /login (tam sesja zostanie odrzucona/odświeżona).
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

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
