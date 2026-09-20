'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Logo from '@/components/Logo';

type State =
  | { kind: 'loading' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

const CARD = 'w-full max-w-sm rounded-card border border-border bg-surface p-8 shadow-card';

// Potwierdzenie rejestracji firmy na adres, który wcześniej ktoś zaprosił do innej organizacji: kliknięcie przejmuje adres i tworzy
// administratora, a hasło ustawia się linkiem z kolejnego maila.
function ClaimRegistration() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState<State>({ kind: 'loading' });
  // Link jest jednorazowy - w React Strict Mode (dev) efekt odpala się dwa razy, a drugie wywołanie zwróciłoby błąd po udanym pierwszym.
  const startedRef = useRef(false);

  useEffect(() => {
    if (!token || startedRef.current) {
      return;
    }
    startedRef.current = true;

    fetch('/api/auth/claim-registration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (response.ok) {
          setState({ kind: 'success', message: data?.message ?? 'Adres potwierdzony.' });
        } else {
          setState({ kind: 'error', message: data?.message ?? 'Nie udało się potwierdzić rejestracji.' });
        }
      })
      .catch(() => setState({ kind: 'error', message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' }));
  }, [token]);

  if (!token) {
    return (
      <div className={CARD}>
        <div className="mb-6">
          <Logo variant="dark" height={28} />
        </div>
        <h1 className="mb-2 text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Nieprawidłowy link</h1>
        <p className="mb-6 text-muted">Ten link jest niekompletny.</p>
        <Link href="/login" className="font-semibold text-accent-ink hover:underline">
          Przejdź do logowania
        </Link>
      </div>
    );
  }

  return (
    <div className={CARD}>
      <div className="mb-6">
        <Logo variant="dark" height={28} />
      </div>
      <h1 className="mb-2 text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Potwierdzenie rejestracji</h1>
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
        <Link href={state.kind === 'success' ? '/login' : '/register'} className="font-semibold text-accent-ink hover:underline">
          {state.kind === 'success' ? 'Przejdź do logowania' : 'Zarejestruj firmę ponownie'}
        </Link>
      )}
    </div>
  );
}

export default function ClaimRegistrationPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-4">
      <Suspense fallback={<div className={CARD}>Ładowanie...</div>}>
        <ClaimRegistration />
      </Suspense>
    </main>
  );
}
