import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Lock, RotateCw, ShieldAlert, X } from 'lucide-react';
import type { FakePage } from '@/lib/courses-types';

// Okno przeglądarki wokół zadania „wpisz adres” (TEXT_INPUT_GUIDED z `frame: 'browser'`, feat/browser-evidence). Czysto wizualne:
// pasek kart, strzałki i pasek adresu z kłódką są dekoracją (aria-hidden), prawdziwe kontrolki (pole + „Sprawdź”) przychodzą z
// TextInputBlock przez `addressBar`. Treść okna (`children`) to stan zadania: pusta karta, komunikat po złej próbie albo ostrzeżenie
// o stronie podszywającej się pod bank. Nigdy żadnych PRAWDZIWYCH formularzy logowania ani pól na dane - fałszywa strona logowania
// (FakeLoginPage, D-184) to obrazek formularza zbudowany z elementów bez interakcji.
export default function BrowserWindow({
  tabTitle,
  addressBar,
  children,
  bodyClassName = 'min-h-[160px] p-4 sm:p-6',
}: {
  tabTitle: string;
  addressBar: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <div data-testid="browser-window" className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <div className="flex items-end gap-2 bg-paper px-3 pt-2" aria-hidden="true">
        <span className="mb-2 flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning" />
          <span className="h-2.5 w-2.5 rounded-full bg-success" />
        </span>
        {/* Tytuł karty zawijany (nie ucinany wielokropkiem) - na telefonie adres z odpowiedzi nie mieści się w jednej linii (D-099). */}
        <span className="flex min-w-0 max-w-[60%] items-center gap-2 rounded-t-lg bg-surface px-3 py-1.5 text-xs text-ink max-sm:max-w-[80%]">
          <span className="min-w-0 break-words">{tabTitle}</span>
          <X className="h-3 w-3 shrink-0 text-muted" />
        </span>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-2 py-2 sm:px-3">
        <span className="hidden shrink-0 items-center gap-1 text-muted-2 sm:flex" aria-hidden="true">
          <ArrowLeft className="h-4 w-4" />
          <ArrowRight className="h-4 w-4" />
          <RotateCw className="h-4 w-4" />
        </span>
        {/* Pole w pasku nie ma własnej ramki - widoczny fokus (WCAG 2.4.7) daje pierścień na całym pasku adresu. */}
        {/* Na telefonie długi adres zawija się na 2-3 wiersze - zaokrąglony prostokąt zamiast „pigułki”, w której wiersze wychodziły poza
            łuki (uwaga właściciela 2026-11-22). */}
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-paper py-1 pl-3 pr-1 focus-within:ring-2 focus-within:ring-accent sm:rounded-full">
          <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" />
          {addressBar}
        </div>
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

/**
 * Fałszywa strona logowania (D-184, uwaga właściciela 2026-11-20): makieta formularza z napisów z treści. Wyłącznie OBRAZEK - żadnego
 * <form>, <input> ani przycisku (nic nie da się wpisać ani wysłać, menedżer haseł niczego nie podpowie); dla czytnika jeden opis.
 */
export function FakeLoginPage({ page, compact = false }: { page: FakePage; compact?: boolean }) {
  const description = `Makieta strony: ${page.brand} – ${page.heading}. Pola: ${page.fields.join(', ')}. Przycisk: ${page.button}.`;
  return (
    <div
      role="img"
      aria-label={description}
      data-testid="fake-login-page"
      className={`flex w-full justify-center bg-[#EEF2F7] ${compact ? 'px-3 py-4' : 'px-4 py-6 sm:py-10'}`}
    >
      <div aria-hidden="true" className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="mb-3 flex items-center gap-2 text-sm font-bold text-[#1F4E79]">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1F4E79] text-xs text-white">
            {page.brand.slice(0, 1).toUpperCase()}
          </span>
          {page.brand}
        </p>
        <p className="text-lg font-bold leading-tight text-slate-900">{page.heading}</p>
        {page.text && <p className="mt-1 text-sm text-slate-600">{page.text}</p>}
        <div className="mt-4 space-y-3">
          {page.fields.map((field, index) => (
            <div key={index}>
              <p className="mb-1 text-xs font-medium text-slate-700">{field}</p>
              <div className="h-9 rounded border border-slate-300 bg-white" />
            </div>
          ))}
        </div>
        <div className="mt-4 flex h-10 items-center justify-center rounded bg-[#1F4E79] text-sm font-semibold text-white">{page.button}</div>
      </div>
    </div>
  );
}

/**
 * Ostrzeżenie przeglądarki po rozstrzygnięciu: adres podszywa się pod bank. Bez formularzy i pól. Tekst jest stały - `frame: 'browser'`
 * oznacza dziś „fałszywa strona banku” (moduł 1); inny scenariusz (np. fałszywe logowanie do poczty) wymaga parametru z treści (B-118).
 */
export function DeceptiveSiteWarning({ address }: { address?: string }) {
  return (
    <div data-testid="browser-deceptive-warning" className="flex flex-col items-center gap-3 rounded-lg bg-danger-soft px-4 py-6 text-center">
      <ShieldAlert aria-hidden="true" className="h-10 w-10 text-danger" />
      <p className="text-lg font-semibold text-ink">Ta strona podszywa się pod bank</p>
      <p className="max-w-md text-sm text-ink">
        {address ? (
          <>
            Adres <span className="break-all font-semibold">{address}</span> nie należy do banku.{' '}
          </>
        ) : null}
        Nie wpisuj tu loginu, hasła ani kodów z SMS-ów.
      </p>
      <p className="max-w-md text-xs text-muted">Kłódka w pasku adresu oznacza tylko szyfrowane połączenie, nie uczciwą stronę.</p>
    </div>
  );
}
