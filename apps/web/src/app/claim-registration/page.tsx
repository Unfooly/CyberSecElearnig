'use client';

import { Suspense, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Logo from '@/components/Logo';

type State =
  | { kind: 'ready' }
  | { kind: 'loading' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

const CARD = 'w-full max-w-sm rounded-card border border-border bg-surface p-8 shadow-card';

// Potwierdzenie rejestracji firmy na adres, który wcześniej ktoś zaprosił do innej organizacji: kliknięcie przejmuje adres (KASUJE
// cudze zaproszenie) i tworzy administratora, a hasło ustawia się linkiem z kolejnego maila.
// To akcja niszcząca, więc NIE wykonuje się sama po wejściu na stronę (skaner poczty albo podgląd linku wykonujący JS nie może jej
// uruchomić) - wymaga świadomego kliknięcia "Potwierdzam". (verify-email zostaje automatyczne: niczego nie niszczy.)
function ClaimRegistration() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState<State>({ kind: 'ready' });
  // Link jest jednorazowy - podwójne kliknięcie nie może wysłać dwóch żądań.
  const startedRef = useRef(false);

  function confirm() {
    if (!token || startedRef.current) {
      return;
    }
    startedRef.current = true;
    setState({ kind: 'loading' });

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
  }

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
      {state.kind === 'ready' && (
        <>
          <p className="mb-4 text-muted">
            Potwierdź, że to Ty rejestrowałeś/-aś organizację na ten adres e-mail. <strong>Kliknięcie unieważni zaproszenie do innej firmy, jeśli takie masz.</strong> Jeśli to nie Ty, po prostu zamknij tę stronę.
          </p>
          <button type="button" onClick={confirm} className="mb-2 h-10 w-full rounded-btn bg-accent px-4 text-sm font-bold text-white hover:bg-accent-hover">
            Potwierdzam
          </button>
        </>
      )}
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
