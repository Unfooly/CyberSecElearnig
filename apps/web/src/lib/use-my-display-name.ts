'use client';

import { useEffect, useState } from 'react';

// Imię i inicjał nazwiska WŁASNEGO konta do legitymacji w odprawie (BriefingBlock, D-081). Pobierane z
// /api/users/me/display-name raz na `userEmail` (jak useMyAvatar) i wyłącznie wtedy, gdy moduł ma odprawę (`enabled`) -
// bez zbędnego żądania na każdym kursie. Brak danych w profilu albo błąd = imię z e-maila (jak Topbar/WelcomeBanner).
// Nic z tego nie trafia do treści modułu ani do progress: tylko render w przeglądarce.

export interface DisplayName {
  firstName: string | null;
  lastInitial: string | null;
}

export interface PlayerIdentity {
  /** "Anna K." (albo samo imię, gdy brak inicjału). */
  label: string;
  /** "AK" - do awatara bez obrazka i numeru odznaki. */
  initials: string;
}

const capitalize = (value: string) => (value ? value.charAt(0).toLocaleUpperCase('pl-PL') + value.slice(1) : value);

/** Imię i inicjał z e-maila: "anna.kowalska@x.pl" -> { firstName: "Anna", lastInitial: "K" }. */
export function displayNameFromEmail(email: string): DisplayName {
  const segments = (email.split('@')[0] ?? '').split(/[._-]+/).filter(Boolean);
  return {
    firstName: segments[0] ? capitalize(segments[0]) : null,
    lastInitial: segments[1] ? segments[1].charAt(0).toLocaleUpperCase('pl-PL') : null,
  };
}

/** Legitymacja bez żadnych danych gracza (brak sesji, np. podgląd dev). */
export const ANONYMOUS_IDENTITY: PlayerIdentity = { label: 'Detektyw', initials: 'D' };

/** Tożsamość na legitymacji: profil, a gdy w nim pusto - e-mail; bez żadnego z nich neutralne "Detektyw". */
export function playerIdentity(fromProfile: DisplayName | null, email: string | null): PlayerIdentity {
  const fallback = email ? displayNameFromEmail(email) : { firstName: null, lastInitial: null };
  const firstName = fromProfile?.firstName ?? fallback.firstName;
  const lastInitial = fromProfile?.firstName ? fromProfile.lastInitial : fallback.lastInitial;
  if (!firstName) return ANONYMOUS_IDENTITY;
  return {
    label: lastInitial ? `${firstName} ${lastInitial}.` : firstName,
    initials: `${firstName.charAt(0).toLocaleUpperCase('pl-PL')}${lastInitial ?? ''}`,
  };
}

/** Numer odznaki: ostatnie 4 znaki numeru sprawy (bez separatorów) + inicjały, np. "0412-AK". Liczony tylko w kliencie. */
export function badgeNumber(caseNo: string | undefined, initials: string): string {
  const tail = (caseNo ?? '').replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase();
  return tail ? `${tail}-${initials}` : initials;
}

export function useMyDisplayName(userEmail: string | null, enabled: boolean): DisplayName | null {
  const [name, setName] = useState<DisplayName | null>(null);

  useEffect(() => {
    // Nowy użytkownik nie może widzieć imienia poprzedniego do czasu odpowiedzi.
    setName(null);
    if (!enabled || !userEmail) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/users/me/display-name');
        if (!response?.ok) return;
        const data = await response.json();
        if (!cancelled) {
          setName({
            firstName: typeof data?.firstName === 'string' ? data.firstName : null,
            lastInitial: typeof data?.lastInitial === 'string' ? data.lastInitial : null,
          });
        }
      } catch {
        // imię z e-maila jako fallback (playerIdentity)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userEmail, enabled]);

  return name;
}
