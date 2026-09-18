'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Logo from '@/components/Logo';

type State =
  | { kind: 'loading' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

function VerifyEmail() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState<State>({ kind: 'loading' });
  // Link jest jednorazowy - w React Strict Mode (dev) efekt odpala się
  // dwa razy, a drugie wywołanie zwróciłoby "już użyty" po udanym pierwszym.
  const startedRef = useRef(false);

  useEffect(() => {
    if (!token || startedRef.current) {
      return;
    }
    startedRef.current = true;

    fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (response.ok) {
          setState({ kind: 'success', message: data?.message ?? 'Adres e-mail potwierdzony.' });
        } else {
          setState({ kind: 'error', message: data?.message ?? 'Nie udało się potwierdzić adresu e-mail.' });
        }
      })
      .catch(() => setState({ kind: 'error', message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' }));
  }, [token]);

  if (!token) {
    return (
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-8 shadow-card">
      <div className="mb-6">
        <Logo variant="dark" height={28} />
      </div>
        <h1 className="mb-2 text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Nieprawidłowy link</h1>
        <p className="mb-6 text-muted">Ten link weryfikacyjny jest niekompletny.</p>
        <Link href="/login" className="font-semibold text-accent-ink hover:underline">
          Przejdź do logowania
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-card border border-border bg-surface p-8 shadow-card">
      <div className="mb-6">
        <Logo variant="dark" height={28} />
      </div>
      <h1 className="mb-2 text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Potwierdzenie adresu e-mail</h1>
      {state.kind === 'loading' && <p className="text-muted">Potwierdzanie...</p>}
      {state.kind === 'success' && (
        <p role="status" className="mb-6 rounded-btn bg-success-soft px-3 py-2 text-sm font-semibold text-success">
          {state.message}
        </p>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="mb-6 rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          {state.message}
        </p>
      )}
      {state.kind !== 'loading' && (
        <Link href="/login" className="font-semibold text-accent-ink hover:underline">
          {state.kind === 'success' ? 'Zaloguj się' : 'Przejdź do logowania (tam wyślesz link ponownie)'}
        </Link>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-4">
      <Suspense fallback={<div className="w-full max-w-sm rounded-card border border-border bg-surface p-8 shadow-card">
      <div className="mb-6">
        <Logo variant="dark" height={28} />
      </div>Ładowanie...</div>}>
        <VerifyEmail />
      </Suspense>
    </main>
  );
}
