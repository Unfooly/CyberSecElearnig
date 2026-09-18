'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

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
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow">
        <h1 className="mb-2 text-2xl font-semibold text-slate-900">Nieprawidłowy link</h1>
        <p className="mb-6 text-sm text-slate-600">Ten link weryfikacyjny jest niekompletny.</p>
        <Link href="/login" className="font-medium text-slate-900 hover:underline">
          Przejdź do logowania
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow">
      <h1 className="mb-2 text-2xl font-semibold text-slate-900">Potwierdzenie adresu e-mail</h1>
      {state.kind === 'loading' && <p className="text-sm text-slate-600">Potwierdzanie...</p>}
      {state.kind === 'success' && (
        <p role="status" className="mb-6 rounded bg-green-50 px-3 py-2 text-sm text-green-700">
          {state.message}
        </p>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="mb-6 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      )}
      {state.kind !== 'loading' && (
        <Link href="/login" className="font-medium text-slate-900 hover:underline">
          {state.kind === 'success' ? 'Zaloguj się' : 'Przejdź do logowania (tam wyślesz link ponownie)'}
        </Link>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Suspense fallback={<div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow">Ładowanie...</div>}>
        <VerifyEmail />
      </Suspense>
    </main>
  );
}
