'use client';

import type { ReactNode } from 'react';

/** Krok zaznaczania domeny w adresie (D-181): 0 - szukamy „/”, 1 - szukamy „.”, 2 - domena zaznaczona. */
export type MarkStep = 0 | 1 | 2;

const MARKED = 'rounded bg-accent px-0.5 font-bold text-white';

/**
 * Adres w pasku przeglądarki do rozłożenia na części (TEXT_INPUT_GUIDED `markUrl`, D-181). Dopóki domena nie jest zaznaczona, klikalne są
 * tylko separatory - każdy „/” i „.” to przycisk (klawiatura: Tab między nimi, Enter), reszta adresu to zwykły tekst; zaznaczony ukośnik
 * ma ramkę. Po obu krokach adres to: początek, zaznaczona kropka, podświetlona domena, zaznaczony ukośnik, reszta. Poprawność kliknięcia
 * ocenia wywołujący (`onPick`) - reguła jest ogólna (urlDomainMarks), nie sekret.
 */
export default function AddressMarker({
  url,
  step,
  slash,
  dot,
  onPick,
}: {
  url: string;
  step: MarkStep;
  slash: number;
  dot: number;
  onPick: (index: number) => void;
}) {
  const wrap = (children: ReactNode) => (
    <span role="group" aria-label="Adres strony" data-testid="address-marker" className="min-w-0 flex-1 break-all py-1 font-mono text-sm leading-8 text-ink">
      {children}
    </span>
  );
  if (step === 2) {
    return wrap(
      <>
        {url.slice(0, dot)}
        <span className={MARKED}>.</span>
        <mark data-testid="address-domain" className="rounded bg-highlight px-0.5 font-bold text-ink">
          {url.slice(dot + 1, slash)}
        </mark>
        <span className={MARKED}>/</span>
        {url.slice(slash + 1)}
      </>,
    );
  }

  const separators = [...url].map((ch, index) => ({ ch, index })).filter(({ ch }) => ch === '/' || ch === '.');
  const slashCount = separators.filter(({ ch }) => ch === '/').length;
  const dotCount = separators.length - slashCount;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const { ch, index } of separators) {
    if (index > last) parts.push(<span key={`t${last}`}>{url.slice(last, index)}</span>);
    last = index + 1;
    const marked = step === 1 && index === slash;
    const isSlash = ch === '/';
    const ordinal = separators.filter((item) => item.ch === ch && item.index <= index).length;
    parts.push(
      <button
        key={index}
        type="button"
        aria-label={`${isSlash ? 'Ukośnik' : 'Kropka'} ${ordinal} z ${isSlash ? slashCount : dotCount}${marked ? ', zaznaczony' : ''}`}
        aria-pressed={marked}
        data-testid="address-separator"
        data-index={index}
        onClick={() => onPick(index)}
        className={`mx-px inline-flex min-h-[32px] min-w-[20px] items-center justify-center rounded px-0.5 font-bold outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          marked ? 'bg-accent text-white' : 'bg-accent-soft text-accent-ink hover:bg-accent/25'
        }`}
      >
        {ch}
      </button>,
    );
  }
  if (last < url.length) parts.push(<span key={`t${last}`}>{url.slice(last)}</span>);
  return wrap(parts);
}
