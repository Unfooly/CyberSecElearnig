'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import type { ContentLocale } from '@cyberszkolo/content';
import { LOCALE_LABEL, saveContentLocale } from '@/lib/content-locale';

// Język kursu w odtwarzaczu (D-133):
//  - plakietka „Available in Polish only” (po angielsku - czyta ją ktoś, kto wybrał EN), gdy kurs nie ma języka gracza i treść jest po polsku;
//  - przełącznik języka na starcie kursu (pierwszy blok, kurs w toku) - tylko gdy kurs ma więcej niż jeden język. Zmiana zapisuje się na
//    koncie („Język szkoleń”), a strona przeładowuje treść w nowym języku (cały kurs w jednym języku - nigdy mieszanka).
//    Przyciski, nie lista: strzałka na zamkniętej liście zmienia wartość od razu (Chrome/Windows), więc każde naciśnięcie zapisywałoby
//    język i przeładowywało kurs (code review i18n-1). W trakcie zapisu aria-disabled - fokus zostaje na przycisku; po przeładowaniu
//    (nowy odtwarzacz, klucz z językiem) fokus wraca na przycisk nowego języka (znacznik w sessionStorage).
// Miejsce (CoursePlayer): pasek górny ramki od 640 px, węziej - wiersz nad treścią bloku (pasek pierwszego bloku nie ma miejsca: odprawa,
// „Pomiń odprawę”, Notatnik - layout-check sekcja `jezyk`). Oba miejsca w HTML, przełączane klasami - bez skoku układu po hydracji.

const FOCUS_FLAG = 'course-language-focus';
// Zapis się udał, a przeładowanie nie zmieniło odtwarzacza (np. błąd sieci przy odświeżeniu) - przełącznik nie może zostać zablokowany.
const PENDING_RESET_MS = 8000;

export function PolishOnlyBadge({ testId = 'polish-only-badge' }: { testId?: string }) {
  return (
    <span
      lang="en"
      data-testid={testId}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 text-xs font-semibold text-amber-900"
    >
      <Languages aria-hidden="true" className="h-4 w-4" />
      Available in Polish only
    </span>
  );
}

function readFocusFlag(): string | null {
  try {
    return window.sessionStorage.getItem(FOCUS_FLAG);
  } catch {
    return null;
  }
}

function writeFocusFlag(value: string | null) {
  try {
    if (value) window.sessionStorage.setItem(FOCUS_FLAG, value);
    else window.sessionStorage.removeItem(FOCUS_FLAG);
  } catch {
    // Brak sessionStorage (tryb prywatny) - tylko bez przywrócenia fokusu.
  }
}

export function CourseLanguageSwitch({
  locale,
  locales,
  testId = 'course-language',
}: {
  locale: ContentLocale;
  locales: readonly ContentLocale[];
  testId?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  // Po przeładowaniu w nowym języku: fokus na przycisku tego języka - w widocznej kopii (pasek albo wiersz nad treścią).
  useEffect(() => {
    if (readFocusFlag() !== locale) return;
    const button = groupRef.current?.querySelector<HTMLButtonElement>(`button[lang="${locale}"]`);
    if (!button || button.getClientRects().length === 0) return;
    writeFocusFlag(null);
    button.focus({ preventScroll: true });
  }, [locale]);

  async function change(next: ContentLocale) {
    if (next === locale || pending) return;
    setPending(true);
    setFailed(false);
    const status = await saveContentLocale(next);
    if (status === 401) {
      router.push('/login');
      return;
    }
    if (status >= 200 && status < 300) {
      writeFocusFlag(next);
      router.refresh();
      // Przeładowanie nie przemontowało odtwarzacza (błąd sieci/RSC): odblokowanie i zdjęcie znacznika - inaczej fokus skoczyłby przy
      // następnym wejściu na dowolny kurs w tym języku.
      resetTimer.current = window.setTimeout(() => {
        writeFocusFlag(null);
        setPending(false);
      }, PENDING_RESET_MS);
      return;
    }
    setFailed(true);
    setPending(false);
  }

  return (
    <div lang="pl" className="flex shrink-0 items-center gap-2">
      <div ref={groupRef} role="group" aria-label="Język szkolenia" data-testid={testId} className="inline-flex overflow-hidden rounded border border-slate-300">
        {locales.map((code) => (
          <button
            key={code}
            type="button"
            lang={code}
            aria-pressed={code === locale}
            aria-disabled={pending || undefined}
            onClick={() => void change(code)}
            className={`h-10 px-2.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
              code === locale ? 'bg-slate-900 text-white' : 'bg-white text-slate-800 hover:bg-slate-50'
            } ${pending ? 'cursor-wait' : ''}`}
          >
            {LOCALE_LABEL[code]}
          </button>
        ))}
      </div>
      {failed && (
        <span role="alert" className="text-xs text-danger">
          Nie udało się zmienić języka.
        </span>
      )}
    </div>
  );
}
