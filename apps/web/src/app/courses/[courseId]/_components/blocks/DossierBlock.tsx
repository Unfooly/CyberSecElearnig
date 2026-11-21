'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Highlighter, Paperclip } from 'lucide-react';
import type { ContentBlock, DossierDocument, DossierRow } from '@/lib/courses-types';
import { flyEvidence } from '@/lib/motion';
import { useNotes } from '../player/notes';
import { useEvidence } from '../player/evidence';
import PhoneStage from '../player/PhoneStage';

// Teczka sprawy (DOSSIER, schemaVersion 5, D-083): dokumenty na przekładkach (po prawej; na telefonie w pionie poziomy
// pasek nad arkuszem), arkusz z nagłówkiem wystawcy i wierszami tabeli. Wiersz to przycisk-zakreślacz (aria-pressed):
// wiersz-dowód zakreśla się na żółto i dopisuje notatkę do notatnika (ta sama ścieżka co "Dodaj do notatnika" hotspotu:
// addNote + licznik dowodów; bez podpowiedzi - przy contentLayout 'fill' PlayerStage jej nie pokazuje, a teczka nie
// ma własnego banera), zwykła linijka pokazuje tylko "Ta linijka wygląda na zwykłą operację." i się nie zaznacza. Odpowiedź dla serwera: { opened: [id dokumentu...], noted: [id wiersza...] } - serwer sprawdza wszystko
// jeszcze raz (evaluate.ts), więc to, co tu jest "wymagane", jest tylko bramką UX, tak jak przy scenach.
//
// Układ: strona się nie przewija - blok wypełnia ramkę (contentLayout 'fill'), a przewija się WYŁĄCZNIE lista wierszy
// arkusza. Animacja kartki przy zmianie przekładki tylko bez prefers-reduced-motion (globals.css, .dossier-sheet-enter).
//
// Przekładki i arkusz (DossierDocuments) ze stanem (useDossier) służą też konsoli przesłuchania (INTERROGATION.documents, D-118).

const ORDINARY = 'Ta linijka wygląda na zwykłą operację.';

/** Stan teczki: bieżący dokument, otwarte dokumenty, zakreślone wiersze-dowody (notatka + licznik dowodów), komunikat arkusza. */
export function useDossier(documents: DossierDocument[], blockId: string | undefined, review: boolean) {
  const [activeId, setActiveId] = useState<string | null>(documents[0]?.id ?? null);
  const [opened, setOpened] = useState<string[]>(documents[0] ? [documents[0].id] : []);
  const [noted, setNoted] = useState<string[]>([]);
  // Ostatnio zakreślony wiersz - tylko on dostaje pociągnięcie zakreślacza (powrót na przekładkę nie powtarza animacji).
  const [lastNoted, setLastNoted] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');
  const { addNote } = useNotes();
  const evidence = useEvidence();

  const rows = documents.flatMap((document) => document.rows);
  const requiredRows = rows.filter((row) => row.required === true).map((row) => row.id);
  const requiredNoted = requiredRows.filter((id) => noted.includes(id)).length;
  const ready = opened.length >= documents.length && requiredNoted >= requiredRows.length;

  function select(id: string) {
    setActiveId(id);
    setLastNoted(null);
    setMessage('');
    setOpened((current) => (current.includes(id) ? current : [...current, id]));
  }

  function mark(row: DossierRow, from?: Element) {
    if (!row.evidence || !row.note) {
      setMessage(row.message ?? ORDINARY);
      return;
    }
    if (noted.includes(row.id)) {
      setMessage('Ten dowód jest już w notatniku.');
      return;
    }
    if (review || !blockId) {
      setMessage('Podgląd ukończonego bloku: zakreślenia się nie zapisują.');
      return;
    }
    setNoted((current) => [...current, row.id]);
    setLastNoted(row.id);
    addNote({ blockId, text: row.note.text, kind: row.note.kind });
    evidence.addPending(`${blockId}.${row.id}`);
    // Ruch (D-090): treść notatki leci od wiersza do Notatnika.
    flyEvidence(from, row.note.text);
    setMessage('Zakreślone. Dowód trafił do notatnika.');
  }

  return { documents, activeId, opened, noted, lastNoted, message, requiredRows, requiredNoted, ready, select, mark };
}

export type DossierState = ReturnType<typeof useDossier>;

/** Przekładki (tablist) i arkusz z wierszami-zakreślaczami - bez ramki teczki (DossierBlock) i bez liczników. */
export function DossierDocuments({
  state,
  tabsLabel = 'Dokumenty w teczce',
  hint: hintProp,
  onScreen = false,
}: {
  state: DossierState;
  tabsLabel?: string;
  hint?: string;
  /** Rozmowa na ekranie telefonu ze sceny (D-181) - bez ramki telefonu czatu. */
  onScreen?: boolean;
}) {
  // Podpowiedź wywołującego (np. konsola przesłuchania) ma pierwszeństwo; domyślna zależy od wyglądu arkusza (D-178: czat).
  const hint = hintProp ?? 'Kliknij linijkę, która nie pasuje do zwykłego dnia.';
  const { documents, activeId, opened, noted, lastNoted, message, select, mark } = state;
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const baseId = `dossier-${useId()}`;
  const active = documents.find((document) => document.id === activeId) ?? null;

  // Przekładki według wzorca ARIA tablist: strzałki w obu osiach (pionowo na desktopie, poziomo na telefonie), Home/End.
  function onTabKeyDown(event: KeyboardEvent, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let target = -1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') target = (index + 1) % documents.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') target = (index - 1 + documents.length) % documents.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = documents.length - 1;
    if (target < 0) return;
    event.preventDefault();
    select(documents[target].id);
    tabRefs.current[documents[target].id]?.focus();
  }

  // Kolumny: pierwsza (zwykle godzina) wąska, reszta dzieli szerokość. Na wąskim ekranie wiersz jest kartą (komórki pod sobą).
  const columnsStyle = (count: number): CSSProperties =>
    ({ '--dossier-cols': count > 1 ? `minmax(4.5rem, auto) repeat(${count - 1}, minmax(0, 1fr))` : 'minmax(0, 1fr)' }) as CSSProperties;

  // Jedna rozmowa w komunikatorze (D-178) - przekładka niczego nie przełącza, więc jej nie pokazujemy (zostaje w DOM: etykieta panelu).
  const soloChat = documents.length === 1 && documents[0].layout === 'chat';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 sm:flex-row-reverse sm:gap-3">
      <div
        role="tablist"
        aria-label={tabsLabel}
        // Klasa, nie atrybut `hidden`: utility `flex` wygrywa z [hidden] z preflightu Tailwinda.
        className={
          soloChat
            ? 'hidden'
            : 'flex shrink-0 gap-1 overflow-x-auto p-0.5 [scrollbar-width:thin] sm:min-h-0 sm:w-40 sm:flex-col sm:overflow-y-auto sm:overflow-x-hidden'
        }
      >
        {documents.map((document, index) => {
          const selected = document.id === activeId;
          return (
            <button
              key={document.id}
              ref={(element) => {
                tabRefs.current[document.id] = element;
              }}
              id={`${baseId}-tab-${document.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={selected ? `${baseId}-panel` : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(document.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              className={`min-h-[44px] shrink-0 whitespace-nowrap rounded-btn border px-3 py-2 text-left text-sm font-semibold sm:whitespace-normal ${
                selected ? 'border-accent bg-accent text-white' : 'border-border bg-surface text-ink hover:bg-paper'
              }`}
            >
              {document.tab}
              {opened.includes(document.id) && !selected && <span aria-hidden="true"> ✓</span>}
            </button>
          );
        })}
      </div>

      {active && active.layout === 'chat' && (
        <ChatSheet
          key={active.id}
          id={`${baseId}-panel`}
          labelledBy={`${baseId}-tab-${active.id}`}
          document={active}
          noted={noted}
          status={message || (hintProp ?? 'Kliknij wiadomość, która coś mówi o ataku.')}
          onMark={mark}
          onScreen={onScreen}
        />
      )}
      {active && active.layout !== 'chat' && (
        <div
          key={active.id}
          id={`${baseId}-panel`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${active.id}`}
          className="dossier-sheet-enter flex min-h-0 flex-1 flex-col rounded-card border border-border bg-surface shadow-card"
        >
          <div className="shrink-0 border-b border-border px-3 py-2 sm:px-4">
            <p className="font-typewriter text-xs uppercase tracking-wide text-muted">{active.org}</p>
            <p className="text-sm font-bold text-ink sm:text-base">{active.title}</p>
            {active.meta && <p className="font-typewriter text-xs text-muted">{active.meta}</p>}
          </div>
          <div
            aria-hidden="true"
            style={columnsStyle(active.columns.length)}
            className="hidden shrink-0 gap-x-3 border-b border-border px-3 py-1.5 font-typewriter text-xs uppercase text-muted sm:grid sm:px-4 sm:[grid-template-columns:var(--dossier-cols)]"
          >
            {active.columns.map((column, index) => (
              <span key={index}>{column}</span>
            ))}
          </div>
          {/* `relative`: spany sr-only (position: absolute) w wierszach mają blok zawierający w liście, która się przewija - inaczej
              wiersze przewinięte poza listę wypychałyby obszar bloku (layout-check (e), 844x390). */}
          <ul data-testid="dossier-rows" className="relative min-h-0 flex-1 overflow-y-auto px-1.5 py-1 [scrollbar-width:thin] sm:px-2.5">
            {active.rows.map((row) => {
              const isNoted = noted.includes(row.id);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    aria-pressed={isNoted}
                    onClick={(event) => mark(row, event.currentTarget)}
                    style={columnsStyle(active.columns.length)}
                    className={`relative isolate my-0.5 grid min-h-[44px] w-full content-center gap-x-3 rounded px-1.5 py-2 text-left font-typewriter text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent sm:[grid-template-columns:var(--dossier-cols)] ${
                      isNoted ? '' : 'hover:bg-paper'
                    }`}
                  >
                    {/* Zakreślacz: osobna warstwa pod tekstem; świeżo zakreślony wiersz - pociągnięcie od lewej (scaleX, 350 ms, D-090). */}
                    {isNoted && (
                      <span
                        aria-hidden="true"
                        data-testid="dossier-highlight"
                        className={`absolute inset-0 -z-10 origin-left rounded bg-highlight ${lastNoted === row.id ? 'motion-safe:animate-highlight-in' : ''}`}
                      />
                    )}
                    {row.cells.map((cell, index) => (
                      <span key={index} className={index === 0 ? 'font-bold' : undefined}>
                        <span className="sr-only">{active.columns[index]}: </span>
                        {cell}
                      </span>
                    ))}
                    {isNoted && (
                      <span className="sr-only">
                        {' '}
                        (zakreślone, w notatniku)
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted sm:px-4">
            <Highlighter aria-hidden="true" className="h-4 w-4 shrink-0" />
            <p role="status" className="min-h-[1rem] flex-1">
              {message || hint}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DossierBlock({
  block,
  contentBase,
  onSubmit,
  onReady,
  review = false,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit: (answer: { opened: string[]; noted: string[] }) => void;
  onReady: (submit: (() => void) | null) => void;
  review?: boolean;
}) {
  const state = useDossier(block.documents ?? [], block.id, review);
  const { opened, noted, ready, requiredRows, requiredNoted, documents } = state;

  useEffect(() => {
    if (review) return;
    onReady(ready ? () => onSubmit({ opened, noted }) : null);
    // onReady/onSubmit celowo poza deps - remount przez `key` na zmianę bloku (jak SceneHotspotsBlock.tsx).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, noted, review]);

  // Rozmowa na ekranie telefonu ze sceny (D-181): bez karty teczki - telefon z biurka wypełnia obszar bloku, czat leży na jego ekranie.
  // Podgląd „Wstecz” - zwykła karta (układ 'slide', jak monitor poczty).
  if (block.phone && !review) {
    return (
      <PhoneStage
        contentBase={contentBase}
        image={block.phone.image}
        screen={block.phone.screen}
        imagePortrait={block.phone.imagePortrait}
        screenPortrait={block.phone.screenPortrait}
        label={block.title ?? 'Telefon'}
      >
        <DossierDocuments state={state} onScreen />
      </PhoneStage>
    );
  }

  return (
    <div data-testid="dossier-block" className="flex min-h-0 w-full flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col rounded-card border border-border bg-accent-soft p-3 sm:p-4">
        <div className="mb-2 flex shrink-0 items-center gap-2 pr-24">
          <Paperclip aria-hidden="true" className="h-5 w-5 shrink-0 -rotate-12 text-muted" />
          <h3 className="truncate text-base font-bold text-ink">{block.title ?? 'Teczka sprawy'}</h3>
        </div>
        {block.stamp && (
          <span className="absolute right-3 top-3 -rotate-6 rounded border-2 border-danger px-2 py-0.5 text-xs font-extrabold uppercase tracking-widest text-danger sm:right-4 sm:top-4">
            <span className="sr-only">Pieczątka: </span>
            {block.stamp}
          </span>
        )}

        <DossierDocuments state={state} />

        {/* Własna stopka zamiast ExploreFooter: dwa liczniki (dokumenty i wymagane dowody). Bez aria-live - każde kliknięcie
            ogłasza już role="status" arkusza, drugi region czytałby zakreślenie podwójnie. */}
        <p className="mt-2 shrink-0 text-xs text-muted">
          {review
            ? 'Podgląd ukończonego bloku: możesz przejrzeć teczkę ponownie, nic się nie zapisuje.'
            : ready
              ? 'Teczka przejrzana.'
              : `Dokumenty: ${opened.length} z ${documents.length}${requiredRows.length > 0 ? ` · wymagane dowody: ${requiredNoted} z ${requiredRows.length}` : ''}.`}
        </p>
      </div>
    </div>
  );
}

/**
 * Treść dymka z fragmentem pokazanym jak link (D-192, uwaga właściciela 2026-11-21: „Rejestracja” na niebiesko, „skoro to link”): pierwsze
 * wystąpienie `link` w treści jest niebieskie i podkreślone (we własnym, fioletowym dymku - białe i podkreślone, dla kontrastu). To tylko
 * wygląd: zwykły <span> bez adresu, nic nie nawiguje; kliknięcie dalej zaznacza cały dymek. Bez `link` albo gdy fragmentu nie ma w treści -
 * sam tekst.
 */
function chatText(text: string, link: string | undefined, mine: boolean) {
  const at = link ? text.indexOf(link) : -1;
  if (!link || at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <span data-testid="chat-link" className={`font-semibold underline underline-offset-2 ${mine ? 'text-white' : 'text-[#1D4ED8]'}`}>
        {link}
      </span>
      {text.slice(at + link.length)}
    </>
  );
}

/**
 * Rozmowa w komunikatorze w ramce telefonu (D-178, `layout: 'chat'`): wiersz dokumentu = dymek, komórki [godzina, autor, treść]. Dymki
 * `self` (właściciel telefonu) po prawej, rozmówcy po lewej, wiersz bez autora (np. „—” - połączenie głosowe) - pigułka na środku. Każdy
 * dymek to ten sam przycisk co linijka arkusza (zaznaczenie do notatek, aria-pressed, komunikat w stopce) - zmienia się tylko wygląd.
 */
function ChatSheet({
  id,
  labelledBy,
  document,
  noted,
  status,
  onMark,
  onScreen = false,
}: {
  id: string;
  labelledBy: string;
  document: DossierDocument;
  noted: string[];
  status: string;
  onMark: (row: DossierRow, from?: Element) => void;
  /** Na ekranie telefonu ze sceny (DOSSIER.phone, D-181): bez własnej ramki telefonu, na cały ekran, komunikat w dolnym pasku ekranu. */
  onScreen?: boolean;
}) {
  const contact = document.title;
  const statusLine = (
    <p
      role="status"
      className={
        onScreen
          ? 'min-h-[2rem] shrink-0 border-t border-[#E3DFF5] bg-white px-2.5 py-1.5 text-center text-xs text-muted'
          : 'mt-2 min-h-[1rem] w-full max-w-[400px] text-center text-xs text-muted'
      }
    >
      {status}
    </p>
  );
  return (
    <div id={id} role="tabpanel" aria-labelledby={labelledBy} data-testid="chat-sheet" className="dossier-sheet-enter flex min-h-0 flex-1 flex-col items-center">
      <div
        className={
          onScreen
            ? 'flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-[#F4F2FB]'
            : 'flex min-h-0 w-full max-w-[400px] flex-1 flex-col overflow-hidden rounded-[30px] border-[10px] border-[#1E1E24] bg-[#F4F2FB] shadow-card'
        }
      >
        <div className="flex shrink-0 items-center gap-2.5 bg-[#6C5CE7] px-3 py-2.5 text-white">
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-bold">
            {contact.trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            {/* Zawijanie zamiast wielokropka (D-179, layout-check xx 390 px): nazwa rozmówcy i data czytelne w całości. */}
            <p className="break-words text-sm font-bold leading-snug">{contact}</p>
            {document.meta && <p className="break-words text-xs text-white/80">{document.meta}</p>}
          </div>
        </div>
        <ul data-testid="dossier-rows" className="relative flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2.5 py-3 [scrollbar-width:thin]">
          {document.rows.map((row) => {
            const [time = '', author = '', text = ''] = row.cells;
            const isNoted = noted.includes(row.id);
            const system = author.trim() === '' || author.trim() === '—';
            const mine = !system && document.self !== undefined && author === document.self;
            return (
              <li key={row.id} className={`flex ${system ? 'justify-center' : mine ? 'justify-end' : 'justify-start'}`}>
                <button
                  type="button"
                  aria-pressed={isNoted}
                  data-testid="chat-bubble"
                  onClick={(event) => onMark(row, event.currentTarget)}
                  className={`relative isolate min-h-[44px] max-w-[85%] text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    system
                      ? 'rounded-full bg-[#E3DFF5] px-3 py-1.5 text-xs font-semibold text-[#3D3570]'
                      : mine
                        ? 'rounded-2xl rounded-br-md bg-[#6C5CE7] px-3 py-2 text-white'
                        : 'rounded-2xl rounded-bl-md bg-white px-3 py-2 text-ink shadow-sm'
                  } ${isNoted ? 'ring-2 ring-[#F4C430] ring-offset-1' : 'hover:brightness-95'}`}
                >
                  {/* text-xs, nie arbitralne px: na telefonie .mobile-readable podbija je do min. 15 px (D-103). */}
                  {!system && !mine && <span className="mb-0.5 block text-xs font-bold text-[#6C5CE7]">{author}</span>}
                  <span className="block whitespace-pre-line">{chatText(text, row.link, mine)}</span>
                  <span className={`mt-0.5 block text-right text-xs ${mine ? 'text-white/75' : 'text-muted'}`}>{time}</span>
                  {isNoted && <span className="sr-only"> (zaznaczone, w notatkach)</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {onScreen && statusLine}
      </div>
      {!onScreen && statusLine}
    </div>
  );
}
