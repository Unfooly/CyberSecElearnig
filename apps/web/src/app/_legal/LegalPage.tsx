import type { ReactNode } from 'react';
import Link from 'next/link';
import { LEGAL_DOCUMENT_VERSION } from '@cyberszkolo/shared';
import Logo from '@/components/Logo';

export const PLACEHOLDER = '[DO UZUPEŁNIENIA]';

// Wspólny układ stron prawnych. Treść jest ROBOCZA (wersja LEGAL_DOCUMENT_VERSION,
// zapisywana przy zgodach w rejestracji) - do zastąpienia tekstami od prawnika
// przed publicznym startem; strony mają noindex, dopóki nie są gotowe.
export default function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="flex h-16 items-center border-b border-border bg-surface px-6">
        <Link href="/" aria-label="Unfooly - strona główna">
          <Logo variant="dark" />
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p role="note" className="mb-6 rounded-btn bg-warning-soft px-3 py-2 text-sm font-semibold text-warning">
          Wersja robocza ({LEGAL_DOCUMENT_VERSION}). Treść wymaga uzupełnienia i weryfikacji prawnej przed publicznym startem.
        </p>
        <h1 className="mb-6 text-[32px] font-extrabold leading-tight tracking-[-0.02em]">{title}</h1>
        <div className="space-y-6 text-[15px] leading-relaxed [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_ul]:list-disc [&_ul]:pl-6">
          {children}
        </div>
      </main>
    </div>
  );
}
