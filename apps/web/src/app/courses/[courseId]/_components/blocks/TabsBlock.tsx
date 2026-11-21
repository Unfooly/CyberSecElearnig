'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Paperclip } from 'lucide-react';
import type { ContentBlock } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { useCompleteHint } from '../player/hints';
import { SimpleMarkdown } from '../simple-markdown';
import ExploreFooter from './ExploreFooter';
import BlockBackground from './BlockBackground';

// Zakładki według wzorca ARIA (tablist/tab/tabpanel, strzałki, Home/End, roving tabindex). Zakładka liczy się jako otwarta po wyświetleniu.
// Odpowiedź dla serwera: { opened: [id...] }.
export default function TabsBlock({
  block,
  onSubmit,
  onReady,
  review = false,
  contentBase = '',
}: {
  block: ContentBlock;
  /** Baza adresów zasobów (tło pod teczką, D-178). */
  contentBase?: string;
  onSubmit: (answer: { opened: string[] }) => void;
  /** Zgłasza gotowość do "Dalej" w pasku powłoki (wymagane zakładki otwarte) - CoursePlayer woła zwróconą funkcję zamiast osobnego "Kontynuuj". */
  onReady: (submit: (() => void) | null) => void;
  review?: boolean;
}) {
  const tabs = block.tabs ?? [];
  const [activeId, setActiveId] = useState<string | null>(tabs[0]?.id ?? null);
  const [opened, setOpened] = useState<string[]>(tabs[0] ? [tabs[0].id] : []);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const baseId = `tabs-${useId()}`; // unikalne także dla dwóch zamontowanych bloków (ukryty bieżący + podgląd)

  // Jak na serwerze: requiredTabs albo wszystkie zakładki (zakładki nie mają flag required).
  const required = block.requiredTabs ?? tabs.map((tab) => tab.id);
  const doneCount = required.filter((id) => opened.includes(id)).length;
  const active = tabs.find((tab) => tab.id === activeId) ?? null;
  const photoUrl = contentAssetUrl(contentBase, active?.photo, 'image');
  // Które zdjęcia są poziome (po wczytaniu) - poziome dostają szerszą ramkę (D-196).
  const [widePhotos, setWidePhotos] = useState<Record<string, boolean>>({});
  const photoWide = photoUrl ? widePhotos[photoUrl] === true : false;
  function notePhotoRatio(url: string, width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    const wide = width > height * 1.15;
    setWidePhotos((current) => (current[url] === wide ? current : { ...current, [url]: wide }));
  }
  const ready = doneCount >= required.length;
  useCompleteHint(block.reactions?.complete, ready, review);

  useEffect(() => {
    if (review) return;
    onReady(ready ? () => onSubmit({ opened }) : null);
    // onReady/onSubmit celowo poza deps - patrz wyjaśnienie w SceneHotspotsBlock.tsx (remount przez `key` na zmianę bloku, nie "stabilność").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, review]);

  function select(id: string, focus = false) {
    setActiveId(id);
    setOpened((current) => (current.includes(id) ? current : [...current, id]));
    if (focus) buttons.current[id]?.focus();
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey) return; // np. Alt+strzałka to nawigacja przeglądarki
    let target = -1;
    if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = tabs.length - 1;
    if (target < 0) return;
    event.preventDefault();
    select(tabs[target].id, true);
  }

  // Teczka sprawy (D-178, `look: 'folder'`): manilowa teczka z przekładkami (zakładki), kartka papieru i opcjonalna pieczątka. Te same role
  // ARIA i klawiatura - zmieniają się wyłącznie klasy.
  const folder = block.look === 'folder';
  const tabClass = (selected: boolean) =>
    folder
      ? // Kolory Unfooly (D-186, uwaga właściciela 2026-11-20): fioletowa teczka, wybrana przekładka biała jak kartka.
        `min-h-[44px] rounded-t-xl px-4 py-2 text-sm font-bold ${selected ? 'bg-surface text-ink' : 'bg-accent-ink text-white hover:bg-accent-hover'}`
      : `min-h-[44px] rounded-t border-b-2 px-3 py-2 text-sm font-medium ${
          selected ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900'
        }`;

  // Teczka na biurku ma STAŁĄ wysokość (D-186, uwaga właściciela 2026-11-20: „teczka zmienia wysokość w zależności od kontentu, a powinna
  // być stała”): wypełnia obszar bloku (kolumna najwyżej 40 rem), kartka przewija się w środku - przełączanie zakładek nie zmienia rozmiaru.
  const desk = folder && !!block.background && !review;
  const content = (
    <>
      <div
        role="tablist"
        aria-label={block.title ?? 'Zakładki'}
        // Miejsce na pieczątkę: na telefonie tekst rośnie do 15 px (.mobile-readable), stąd szersza rezerwa.
        className={folder ? `flex shrink-0 flex-wrap gap-1.5 ${block.stamp ? 'pr-40 sm:pr-44' : ''}` : 'mb-3 flex flex-wrap gap-1 border-b border-slate-200'}
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              buttons.current[tab.id] = element;
            }}
            id={`${baseId}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeId === tab.id}
            aria-controls={activeId === tab.id ? `${baseId}-panel-${tab.id}` : undefined}
            tabIndex={activeId === tab.id ? 0 : -1}
            onClick={() => select(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={tabClass(activeId === tab.id)}
          >
            {tab.title}
            {opened.includes(tab.id) && activeId !== tab.id && <span aria-hidden="true"> ✓</span>}
          </button>
        ))}
      </div>
      {active && (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${active.id}`}
          aria-labelledby={`${baseId}-tab-${active.id}`}
          tabIndex={0}
          data-testid={folder ? 'folder-sheet' : undefined}
          className={
            folder
              ? // flow-root: zdjęcie (float, D-191) nie wychodzi poza kartkę przy krótkiej treści.
                `${desk ? 'min-h-0 flex-1 overflow-y-auto' : 'flow-root min-h-[220px]'} rounded-b-xl rounded-tr-xl bg-surface p-5 text-ink shadow-[0_1px_0_rgba(0,0,0,0.04),inset_0_0_0_1px_rgba(63,50,181,0.12)] sm:p-7`
              : 'rounded bg-slate-50 p-3'
          }
        >
          {/* Zdjęcie przypięte do kartki (D-191, uwaga właściciela 2026-11-21: przy ofierze ataku „jego zdjęcie twarzy”): jak zdjęcie
              legitymacyjne pod spinaczem w prawym górnym rogu, tekst kartki opływa je z lewej. Tylko w teczce (walidacja treści). */}
          {folder && photoUrl && (
            // Proporcje z pliku (D-196: zdjęcia pionowe, kwadratowe i poziome) - ramka nie przycina; poziome zdjęcie dostaje szerszą ramkę.
            <figure
              data-testid="folder-photo"
              data-wide={photoWide ? 'true' : undefined}
              className={`relative float-right mb-2 ml-4 mt-1 rotate-2 rounded-sm bg-white p-1.5 shadow-[0_6px_16px_rgba(0,0,0,0.28)] ring-1 ring-black/10 ${photoWide ? 'w-32 sm:w-56' : 'w-24 sm:w-44'}`}
            >
              <Paperclip aria-hidden="true" className="absolute -top-3 left-3 h-7 w-7 -rotate-12 text-slate-500" strokeWidth={1.75} />
              {/* eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src), bez optymalizatora Next */}
              <img
                key={photoUrl}
                ref={(img) => {
                  // Obraz z pamięci podręcznej nie da już onLoad - proporcje od razu z gotowego obrazu.
                  if (img?.complete && img.naturalWidth > 0) notePhotoRatio(photoUrl, img.naturalWidth, img.naturalHeight);
                }}
                src={photoUrl}
                alt={active.photoAlt ?? ''}
                referrerPolicy="no-referrer"
                className="block h-auto w-full"
                onLoad={(event) => notePhotoRatio(photoUrl, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
              />
            </figure>
          )}
          <div className={folder ? 'space-y-3 text-[15px] leading-relaxed sm:text-base' : 'space-y-2 text-slate-800'}>
            <SimpleMarkdown text={active.content} />
          </div>
        </div>
      )}
    </>
  );

  // Tło pod teczką (D-178): biurko na cały obszar bloku (CoursePlayer daje wtedy układ 'scene' - podpowiedź bloku w rogu), teczka
  // wyśrodkowana na nim; teksty poza teczką (polecenie, licznik zakładek) na jasnym podłożu - nie leżą wprost na grafice (jak odsłuch,
  // B-138). Podgląd „Wstecz” - bez tła (zwykły slajd).
  const onDesk = desk ? 'w-fit shrink-0 rounded-card bg-surface/95 px-3 py-1.5 shadow-card' : '';
  const body = (
    <>
      {block.prompt && <p className={`mb-3 text-lg text-slate-900 ${onDesk}`}>{block.prompt}</p>}
      {folder ? (
        <div
          data-testid="folder"
          className={`relative rounded-2xl bg-accent p-3 sm:p-5 ${desk ? 'flex min-h-0 flex-1 flex-col shadow-[0_18px_40px_rgba(0,0,0,0.55)]' : 'shadow-card'}`}
        >
          {block.stamp && (
            <p
              data-testid="folder-stamp"
              // Biała pieczątka na fioletowej teczce (D-186) - czerwień na fiolecie nie miałaby kontrastu; biel na #6C5CE7 ok. 4.6:1.
              className="pointer-events-none absolute right-3 top-3 z-10 rotate-[-6deg] rounded-md border-[3px] border-white px-2.5 py-0.5 text-xs font-extrabold uppercase tracking-[0.08em] text-white sm:right-5 sm:top-4 sm:text-sm"
            >
              {block.stamp}
            </p>
          )}
          {content}
        </div>
      ) : (
        content
      )}
      <ExploreFooter done={doneCount} total={required.length} noun="zakładek" review={review} className={desk ? `mt-4 text-sm text-slate-700 ${onDesk}` : undefined} />
    </>
  );
  if (!desk) return <div>{body}</div>;
  // Tło w zewnętrznym (nieprzewijanym) elemencie - nie jedzie z treścią. Teczka o stałej wysokości (D-186): kolumna na cały obszar (najwyżej
  // 40 rem razem z poleceniem i licznikiem), wyśrodkowana w pionie; przewija się tylko kartka w teczce.
  return (
    <div data-testid="folder-desk" className="relative isolate flex min-h-0 w-full flex-1 flex-col">
      <BlockBackground contentBase={contentBase} image={block.background} imagePortrait={block.backgroundPortrait} />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 py-5 sm:px-8 sm:py-8">
        <div data-testid="folder-column" className="flex h-full max-h-[40rem] min-h-0 w-full max-w-3xl flex-col">
          {body}
        </div>
      </div>
    </div>
  );
}
