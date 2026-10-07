'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { ContentLocale } from '@cyberszkolo/content';
import { DEFAULT_LESSON_HTML, TRACKING_TOKEN_REGEX } from '@/lib/tracking';
import { LANDING_TEXT } from '@/lib/landing-text';

// Kliknięcie zaliczamy dopiero po chwili widoczności strony albo po pierwszej interakcji: skanery linków, które
// wykonują JS, zwykle nie czekają ani nie klikają. To ograniczenie, nie gwarancja (opis: docs/phishing-simulations.md).
const VIEW_DELAY_MS = 2500;

async function post(kind: 'view' | 'submit', token: string): Promise<string> {
  try {
    // Bez ciała: wartości z formularza nigdy nie opuszczają przeglądarki. Bez cookie (same-origin, brak credentials).
    const response = await fetch(`/api/t/${encodeURIComponent(token)}/${kind}`, { method: 'POST', credentials: 'omit', cache: 'no-store' });
    const data = await response.json().catch(() => null);
    return response.ok && typeof data?.lessonHtml === 'string' ? data.lessonHtml : DEFAULT_LESSON_HTML;
  } catch {
    return DEFAULT_LESSON_HTML;
  }
}

/**
 * Ogólna, "firmowa" strona weryfikacji konta (bez marek). Pola formularza celowo nie mają atrybutu name i nie są
 * czytane w kodzie: wysyłamy sam fakt wysłania formularza, nigdy jego wartości. Po wysłaniu (albo "Anuluj") pokazujemy
 * lekcję "To była symulacja" z kampanii w piaskownicy (iframe sandbox="", bez skryptów).
 */
export default function LandingClient({ token, locale = 'pl' }: { token: string; locale?: ContentLocale }) {
  // Teksty strony w języku przeglądarki (D-133, wybór po stronie serwera - page.tsx).
  const t = LANDING_TEXT[locale];
  const [lessonHtml, setLessonHtml] = useState<string | null>(null);
  const viewed = useRef<Promise<string> | null>(null);

  // Jedno wywołanie "view" na wizytę (także przy kilku zdarzeniach interakcji).
  const registerView = useCallback((): Promise<string> => {
    if (!viewed.current) {
      viewed.current = TRACKING_TOKEN_REGEX.test(token) ? post('view', token) : Promise.resolve(DEFAULT_LESSON_HTML);
    }
    return viewed.current;
  }, [token]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (document.visibilityState === 'visible') {
        void registerView();
      }
    }, VIEW_DELAY_MS);
    const onInteraction = () => void registerView();
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    events.forEach((name) => window.addEventListener(name, onInteraction, { once: true, passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((name) => window.removeEventListener(name, onInteraction));
    };
  }, [registerView]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.currentTarget.reset(); // wartości znikają z pól; nigdzie ich nie odczytujemy
    await registerView();
    setLessonHtml(TRACKING_TOKEN_REGEX.test(token) ? await post('submit', token) : DEFAULT_LESSON_HTML);
  }

  async function handleCancel() {
    setLessonHtml(await registerView());
  }

  if (lessonHtml !== null) {
    return (
      <main lang={locale} className="mx-auto max-w-2xl px-6 py-12">
        <div role="status" className="rounded-card border border-border bg-surface p-6 shadow-card">
          <p className="mb-4 inline-block rounded-full bg-accent-soft px-3 py-1 text-xs font-bold uppercase tracking-wide text-accent-ink">
            {t.exercise}
          </p>
          <iframe title={t.lesson} sandbox="" srcDoc={`<!doctype html><html lang="pl"><head><meta charset="utf-8"></head><body style="font-family:sans-serif;font-size:15px;line-height:1.5">${lessonHtml}</body></html>`} className="h-80 w-full border-0" />
          <p className="mt-4 text-sm text-muted">{t.close}</p>
        </div>
      </main>
    );
  }

  return (
    <main lang={locale} className="mx-auto max-w-md px-6 py-16">
      <div className="rounded-card border border-border bg-surface p-8 shadow-card">
        <h1 className="text-xl font-extrabold">{t.title}</h1>
        <p className="mt-2 text-sm text-muted">{t.intro}</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4" autoComplete="off">
          <label className="block text-sm font-bold">
            {t.email}
            <input type="text" autoComplete="off" className="mt-1 h-10 w-full rounded-btn border border-border px-3 font-medium" />
          </label>
          <label className="block text-sm font-bold">
            {t.password}
            <input type="password" autoComplete="off" className="mt-1 h-10 w-full rounded-btn border border-border px-3 font-medium" />
          </label>
          <button type="submit" className="h-10 w-full rounded-btn bg-accent font-bold text-white hover:bg-accent-hover">
            {t.confirm}
          </button>
          <button type="button" onClick={handleCancel} className="w-full text-sm font-semibold text-muted hover:underline">
            {t.cancel}
          </button>
        </form>
      </div>
    </main>
  );
}
