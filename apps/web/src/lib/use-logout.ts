'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Wylogowanie z interfejsu: jeden punkt prawdy dla wszystkich miejsc, z których
 * da się wylogować (UserMenu w Topbarze, PendingHeader). Trasa BFF
 * `/api/auth/logout` unieważnia sesję w apps/api i czyści oba httpOnly cookies -
 * POST, nie GET (logout-CSRF), a sama trasa dodatkowo wymaga tego samego źródła.
 *
 * Awaria sieci nie zatrzymuje przejścia na /login: cookies czyści serwer, a gdyby
 * i on nie odpowiedział, sesja zostanie odrzucona przy kolejnym wejściu. Trasa
 * zwraca `sessionRevoked: false`, gdy API nie potwierdziło unieważnienia - dziś
 * tego nie pokazujemy użytkownikowi (backlog B-088).
 */
export function useLogout(): { logout: () => Promise<void>; isLoggingOut: boolean } {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function logout() {
    setIsLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Celowo puste - patrz opis wyżej.
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  return { logout, isLoggingOut };
}
