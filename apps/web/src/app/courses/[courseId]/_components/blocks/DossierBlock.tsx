'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Highlighter, Paperclip } from 'lucide-react';
import type { ContentBlock, DossierRow } from '@/lib/courses-types';
import { useNotes } from '../player/notes';
import { useEvidence } from '../player/evidence';

// Teczka sprawy (DOSSIER, schemaVersion 5, D-083): dokumenty na przekładkach (po prawej; na telefonie w pionie poziomy
// pasek nad arkuszem), arkusz z nagłówkiem wystawcy i wierszami tabeli. Wiersz to przycisk-zakreślacz (aria-pressed):
// wiersz-dowód zakreśla się na żółto i dopisuje notatkę do notatnika (ta sama ścieżka co "Dodaj do notatnika" hotspotu:
// addNote + licznik dowodów; bez reakcji maskotki - przy contentLayout 'fill' PlayerStage jej nie pokazuje, a teczka nie
// ma własnego banera), zwykła linijka pokazuje tylko "Ta linijka wygląda na zwykłą operację." i się nie zaznacza. Odpowiedź dla serwera: { opened: [id dokumentu...], noted: [id wiersza...] } - serwer sprawdza wszystko
// jeszcze raz (evaluate.ts), więc to, co tu jest "wymagane", jest tylko bramką UX, tak jak przy scenach.
//
// Układ: strona się nie przewija - blok wypełnia ramkę (contentLayout 'fill'), a przewija się WYŁĄCZNIE lista wierszy
// arkusza. Animacja kartki przy zmianie przekładki tylko bez prefers-reduced-motion (globals.css, .dossier-sheet-enter).

const ORDINARY = 'Ta linijka wygląda na zwykłą operację.';

export default function DossierBlock({
  block,
  onSubmit,
  onReady,
  review = false,
}: {
  block: ContentBlock;
  onSubmit: (answer: { opened: string[]; noted: string[] }) => void;
  onReady: (submit: (() => void) | null) => void;
  review?: boolean;
}) {
  const documents = block.documents ?? [];
  const [activeId, setActiveId] = useState<string | null>(documents[0]?.id ?? null);
  const [opened, setOpened] = useState<string[]>(documents[0] ? [documents[0].id] : []);
  const [noted, setNoted] = useState<string[]>([]);
  const [message, setMessage] = useState<string>('');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const baseId = `dossier-${useId()}`;
  const { addNote } = useNotes();
  const evidence = useEvidence();

  const active = documents.find((document) => document.id === activeId) ?? null;
  const rows = documents.flatMap((document) => document.rows);
  const requiredRows = rows.filter((row) => row.required === true).map((row) => row.id);
  const requiredNoted = requiredRows.filter((id) => noted.includes(id)).length;
  const ready = opened.length >= documents.length && requiredNoted >= requiredRows.length;

  useEffect(() => {
    if (review) return;
    onReady(ready ? () => onSubmit({ opened, noted }) : null);
    // onReady/onSubmit celowo poza deps - remount przez `key` na zmianę bloku (jak SceneHotspotsBlock.tsx).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, noted, review]);

  function select(id: string, focus = false) {
    setActiveId(id);
    setMessage('');
    setOpened((current) => (current.includes(id) ? current : [...current, id]));
    if (focus) tabRefs.current[id]?.focus();
  }

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
    select(documents[target].id, true);
  }

  function mark(row: DossierRow) {
    if (!row.evidence || !row.note) {
      setMessage(row.message ?? ORDINARY);
      return;
    }
    if (noted.includes(row.id)) {
      setMessage('Ten dowód jest już w notatniku.');
      return;
    }
    if (review || !block.id) {
      setMessage('Podgląd ukończonego bloku: zakreślenia się nie zapisują.');
      return;
    }
    setNoted((current) => [...current, row.id]);
    addNote({ blockId: block.id, text: row.note.text, kind: row.note.kind });
    evidence.addPending(`${block.id}.${row.id}`);
    setMessage('Zakreślone. Dowód trafił do notatnika.');
  }

  // Kolumny: pierwsza (zwykle godzina) wąska, reszta dzieli szerokość. Na wąskim ekranie wiersz jest kartą (komórki pod sobą).
  const columnsStyle = (count: number): CSSProperties =>
    ({ '--dossier-cols': count > 1 ? `minmax(4.5rem, auto) repeat(${count - 1}, minmax(0, 1fr))` : 'minmax(0, 1fr)' }) as CSSProperties;

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

        <div className="flex min-h-0 flex-1 flex-col gap-2 sm:flex-row-reverse sm:gap-3">
          <div
            role="tablist"
            aria-label="Dokumenty w teczce"
            className="flex shrink-0 gap-1 overflow-x-auto p-0.5 [scrollbar-width:thin] sm:min-h-0 sm:w-40 sm:flex-col sm:overflow-y-auto sm:overflow-x-hidden"
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

          {active && (
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
                        onClick={() => mark(row)}
                        style={columnsStyle(active.columns.length)}
                        className={`my-0.5 grid min-h-[44px] w-full content-center gap-x-3 rounded px-1.5 py-2 text-left font-typewriter text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent sm:[grid-template-columns:var(--dossier-cols)] ${
                          isNoted ? 'bg-highlight' : 'hover:bg-paper'
                        }`}
                      >
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
                  {message || 'Kliknij linijkę, która nie pasuje do zwykłego dnia.'}
                </p>
              </div>
            </div>
          )}
        </div>

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
