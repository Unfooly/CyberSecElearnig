import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Lock, RotateCw, ShieldAlert, X } from 'lucide-react';

// Okno przeglądarki wokół zadania „wpisz adres” (TEXT_INPUT_GUIDED z `frame: 'browser'`, feat/browser-evidence). Czysto wizualne:
// pasek kart, strzałki i pasek adresu z kłódką są dekoracją (aria-hidden), prawdziwe kontrolki (pole + „Sprawdź”) przychodzą z
// TextInputBlock przez `addressBar`. Treść okna (`children`) to stan zadania: pusta karta, komunikat po złej próbie albo ostrzeżenie
// o stronie podszywającej się pod bank. Nigdy żadnych formularzy logowania ani pól na dane - to szkolenie, nie makieta phishingu.
export default function BrowserWindow({ tabTitle, addressBar, children }: { tabTitle: string; addressBar: ReactNode; children: ReactNode }) {
  return (
    <div data-testid="browser-window" className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <div className="flex items-end gap-2 bg-paper px-3 pt-2" aria-hidden="true">
        <span className="mb-2 flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning" />
          <span className="h-2.5 w-2.5 rounded-full bg-success" />
        </span>
        <span className="flex min-w-0 max-w-[60%] items-center gap-2 rounded-t-lg bg-surface px-3 py-1.5 text-xs text-ink">
          <span className="truncate">{tabTitle}</span>
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
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-paper py-1 pl-3 pr-1 focus-within:ring-2 focus-within:ring-accent">
          <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" />
          {addressBar}
        </div>
      </div>
      <div className="min-h-[160px] p-4 sm:p-6">{children}</div>
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
