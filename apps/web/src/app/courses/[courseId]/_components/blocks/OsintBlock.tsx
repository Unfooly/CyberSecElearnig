'use client';

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Award, Check, CircleAlert, Pause, Play, X } from 'lucide-react';
import type { ContentBlock, OsintSpot, ResultDetail } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { usePhoneLayout } from '@/lib/use-phone-layout';
import { usePortraitContainer } from '@/lib/use-portrait-container';
import { useNotes } from '../player/notes';
import { DEFAULT_HINT, useHints } from '../player/hints';
import { useOverlayLayer } from '../player/overlay-stack';
import Hint from '../player/Hint';
import TextLayer from './TextLayer';

// OSINT (OSINT_SPOT, D-120/D-121): strona www (grafika + tekst w warstwie) z obszarami; gracz zaznacza informacje, które wykorzystał
// oszust (przyciski-przełączniki, aria-pressed; pole trafienia ≥ 44 px). Na telefonie w pionie - wariant pionowy strony (imagePortrait +
// portraitSpots) na całą szerokość, przewijany w pionie; poziomo - strona w całości („contain”), a na telefonie w poziomie (niska ramka:
// „contain” dałby stronę ~240 px, tekst warstwy nieczytelny) wariant poziomy na całą szerokość, przewijany w pionie. Obszar z nagraniem (webinar) ma własny
// przycisk odtwarzania: nakładka z kadrem, odtwarzaniem i transkrypcją. Ukryte zakończenie (secretEnding) liczy się jako wysłuchane po
// końcu nagrania ALBO po doczytaniu transkrypcji do końca (alternatywa tekstowa) - wyróżnienie od razu w notatniku; do serwera idzie
// `heard` z zapisem bloku. „Dalej” (zapis) po zaznaczeniu co najmniej jednego obszaru; wynik (po ocenie i w podglądzie „Wstecz”) na tej
// samej stronie: trafione, przeoczone, pułapki z wyjaśnieniem (detail.spots z serwera).

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export interface OsintAnswer {
  marked: string[];
  heard?: string[];
}

type Rect = { x: number; y: number; w: number; h: number };

export default function OsintBlock({
  block,
  contentBase,
  onSubmit,
  onReady,
  disabled = false,
  result,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit?: (answer: OsintAnswer) => void;
  onReady?: (submit: (() => void) | null) => void;
  /** Zapis w toku - zaznaczenia zablokowane (inaczej zmiana zaznaczenia podmieniłaby funkcję zapisu). */
  disabled?: boolean;
  /** Wynik (po zapisie albo podgląd „Wstecz”): rozstrzygnięcie z serwera (detail.spots, z zaznaczeniami gracza). */
  result?: { detail?: ResultDetail; points?: number };
}) {
  const spots = block.spots ?? [];
  const hints = useHints();
  const { addDistinction } = useNotes();
  const [frameRef, portraitStage] = usePortraitContainer<HTMLDivElement>();
  const portrait = !!portraitStage && !!block.imagePortrait && (block.portraitSpots?.length ?? 0) > 0;
  const phone = usePhoneLayout();
  const scrolled = portrait || phone;
  const [marked, setMarked] = useState<string[]>([]);
  const [heard, setHeard] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [playerFor, setPlayerFor] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState(16 / 10);
  const playButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const imageUrl = contentAssetUrl(contentBase, portrait ? block.imagePortrait : block.image, 'image');
  const rectOf = (spot: OsintSpot): Rect => (portrait ? (block.portraitSpots?.find((p) => p.id === spot.id) ?? spot) : spot);
  const ready = !result && marked.length > 0;
  const outcomes = new Map((result?.detail?.spots ?? []).map((spot) => [spot.id, spot]));

  useEffect(() => {
    if (result) return;
    onReady?.(ready ? () => onSubmit?.({ marked, ...(heard.length > 0 ? { heard } : {}) }) : null);
    // onReady/onSubmit celowo poza deps - remount przez `key` na zmianę bloku.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, marked, heard]);

  function toggle(spot: OsintSpot) {
    if (disabled || result) return;
    setMarked((list) => (list.includes(spot.id) ? list.filter((id) => id !== spot.id) : [...list, spot.id]));
    setStatus('');
  }

  function onHeard(spot: OsintSpot) {
    const ending = spot.media?.secretEnding;
    // W widoku wyniku blok jest już zapisany - `heard` nie dotarłby do serwera, a lokalne wyróżnienie znikałoby po odświeżeniu.
    if (result || !ending || heard.includes(ending.id) || !block.id) return;
    setHeard((list) => [...list, ending.id]);
    addDistinction({ blockId: block.id, label: ending.label, ...(ending.note ? { note: ending.note } : {}) });
    setStatus(`Odkryte do końca: ${ending.label}. Zapisane w notatniku.`);
  }

  function closePlayer() {
    const spotId = playerFor;
    setPlayerFor(null);
    if (spotId) window.setTimeout(() => playButtons.current[spotId]?.focus(), 0);
  }

  const playerSpot = playerFor ? spots.find((spot) => spot.id === playerFor) : undefined;
  const missed = result ? spots.filter((spot) => outcomes.get(spot.id)?.used && !outcomes.get(spot.id)?.marked) : [];
  const traps = result ? spots.filter((spot) => outcomes.get(spot.id)?.marked && !outcomes.get(spot.id)?.used) : [];
  const hits = result ? spots.filter((spot) => outcomes.get(spot.id)?.used && outcomes.get(spot.id)?.marked).length : 0;
  const usedTotal = result ? spots.filter((spot) => outcomes.get(spot.id)?.used).length : 0;

  return (
    <div data-testid="osint-block" className="relative flex min-h-0 w-full flex-1 flex-col">
      {!result && <Hint variant="bar" text={hints.hint ?? block.tip ?? DEFAULT_HINT.OSINT_SPOT} />}
      {block.prompt && !result && <p className="mb-2 shrink-0 text-ink">{block.prompt}</p>}
      {result && (
        <p data-testid="osint-summary" className="mb-2 shrink-0 text-ink">
          Wykorzystane informacje: {hits} z {usedTotal}
          {traps.length > 0 ? ` · pułapki: ${traps.length}` : ''}
          {result.points !== undefined ? ` · wynik ${Math.round(result.points * 100)}%` : ''}.
        </p>
      )}

      {/* Ramka strony: poziomo - strona w całości („contain”, jak zbliżenie z warstwą tekstu); pionowo i na telefonie - na całą
          szerokość, przewijana. */}
      <div
        ref={frameRef}
        data-testid="osint-frame"
        data-variant={portrait ? 'portrait' : 'landscape'}
        data-scroll={scrolled ? 'true' : undefined}
        className={`relative min-h-0 flex-1 ${scrolled ? 'overflow-y-auto' : 'zoom-layer-frame flex items-center justify-center overflow-hidden'}`}
      >
        {portraitStage !== null && (
          <div
            data-testid="osint-page"
            className={`relative isolate rounded border border-border bg-surface shadow-card ${scrolled ? 'w-full' : 'zoom-layer-box'}`}
            style={{ '--scene-ratio': String(aspectRatio), aspectRatio: 'var(--scene-ratio)' } as CSSProperties}
          >
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src)
              <img
                src={imageUrl}
                alt={block.imageAlt ?? ''}
                referrerPolicy="no-referrer"
                className="block h-full w-full object-contain"
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalWidth > 0 && naturalHeight > 0) setAspectRatio(naturalWidth / naturalHeight);
                }}
              />
            )}
            <TextLayer items={block.textLayer} portrait={portrait} />
            {spots.map((spot) => {
              const rect = rectOf(spot);
              const place = { left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` };
              const isMarked = result ? !!outcomes.get(spot.id)?.marked : marked.includes(spot.id);
              const outcome = outcomes.get(spot.id);
              const tone = !result
                ? isMarked
                  ? 'border-accent bg-accent/20'
                  : 'border-dashed border-accent/50 hover:bg-accent/10'
                : outcome?.used && outcome.marked
                  ? 'border-success bg-success/20'
                  : outcome?.used
                    ? 'border-dashed border-amber-500 bg-amber-400/20'
                    : outcome?.marked
                      ? 'border-danger bg-danger/15'
                      : 'border-transparent';
              const verdict = !outcome ? '' : outcome.used ? (outcome.marked ? ' (wykorzystane - zaznaczone)' : ' (wykorzystane - przeoczone)') : outcome.marked ? ' (pułapka - zaznaczona)' : '';
              return (
                <div key={spot.id} className="absolute" style={place} data-spot-id={spot.id}>
                  <button
                    type="button"
                    data-testid="osint-spot"
                    aria-pressed={isMarked}
                    aria-label={`${spot.label}${verdict}`}
                    disabled={!!result || disabled}
                    onClick={() => toggle(spot)}
                    className={`absolute inset-0 rounded border-2 ${tone} ${FOCUS_RING} disabled:cursor-default`}
                  >
                    {/* Pole trafienia min. 44 px wokół środka drobnego obszaru (jak przedmioty sceny w pionie, D-116). */}
                    <span aria-hidden="true" data-hit className="absolute left-1/2 top-1/2 h-full min-h-[44px] w-full min-w-[44px] -translate-x-1/2 -translate-y-1/2" />
                    {isMarked && !result && (
                      <span aria-hidden="true" className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white">
                        <Check className="h-4 w-4" />
                      </span>
                    )}
                  </button>
                  {spot.media && (
                    // Okrągła ikona na narożniku obszaru (nie w środku): na małej ramce (telefon w poziomie) przycisk w obszarze
                    // zasłaniał jego środek i obszaru nie dało się zaznaczyć. Przy prawej krawędzi obszaru (w poziomie nie wychodzi - obszar
                    // sięgający krawędzi strony przyciąłby przycisk), w pionie wysunięty o połowę pod obszar, chyba że obszar sięga dołu strony.
                    <button
                      ref={(element) => {
                        playButtons.current[spot.id] = element;
                      }}
                      type="button"
                      data-testid="osint-play"
                      onClick={() => setPlayerFor(spot.id)}
                      aria-label={`Odtwórz: ${spot.media.title}`}
                      title="Odtwórz"
                      className={`absolute bottom-0 right-1 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-ink text-white shadow-card hover:bg-ink/85 ${
                        rect.y + rect.h < 95 ? 'translate-y-1/2' : ''
                      } ${FOCUS_RING}`}
                    >
                      <Play aria-hidden="true" className="h-5 w-5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 pt-2">
        <p role="status" data-testid="osint-status" className="min-h-[1.25rem] text-sm text-ink">
          {status}
        </p>
        {!result ? (
          <p className="text-sm text-slate-600">
            {marked.length === 0 ? 'Zaznacz na stronie informacje, które mógł wykorzystać oszust.' : `Zaznaczono: ${marked.length}. „Dalej” w pasku sprawdza zaznaczenia.`}
          </p>
        ) : (
          (missed.length > 0 || traps.length > 0) && (
            <ul data-testid="osint-explanations" className="max-h-[30cqh] space-y-1 overflow-y-auto text-sm text-ink">
              {missed.map((spot) => (
                <li key={spot.id} className="flex items-start gap-2">
                  <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    <span className="font-semibold">{spot.label}</span> - oszust to wykorzystał, a zostało przeoczone.
                  </span>
                </li>
              ))}
              {traps.map((spot) => (
                <li key={spot.id} className="flex items-start gap-2">
                  <X aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  <span>
                    <span className="font-semibold">{spot.label}</span> - {outcomes.get(spot.id)?.trapText ?? 'tego oszust nie wykorzystał.'}
                  </span>
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      {playerSpot?.media && (
        <MediaPlayer
          spot={playerSpot}
          contentBase={contentBase}
          portrait={!!portraitStage}
          heard={!!playerSpot.media.secretEnding && heard.includes(playerSpot.media.secretEnding.id)}
          onHeard={() => onHeard(playerSpot)}
          onClose={closePlayer}
        />
      )}
    </div>
  );
}

/**
 * Nakładka nagrania przy obszarze (webinar): kadr z tekstem w warstwie (wariant pionowy na telefonie), odtwarzanie/pauza z postępem,
 * transkrypcja jako alternatywa (WCAG 1.2.1). Koniec nagrania albo doczytana do końca transkrypcja = wysłuchane (ukryte zakończenie).
 */
function MediaPlayer({
  spot,
  contentBase,
  portrait,
  heard,
  onHeard,
  onClose,
}: {
  spot: OsintSpot;
  contentBase: string;
  portrait: boolean;
  heard: boolean;
  onHeard: () => void;
  onClose: () => void;
}) {
  const media = spot.media!;
  const audioUrl = contentAssetUrl(contentBase, media.narration.audioUrl, 'audio');
  const imageUrl = contentAssetUrl(contentBase, portrait && media.imagePortrait ? media.imagePortrait : media.image, 'image');
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(!audioUrl);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const endRef = useRef<HTMLParagraphElement | null>(null);
  const onHeardRef = useRef(onHeard);
  onHeardRef.current = onHeard;
  useOverlayLayer('hotspotCard', true, onClose);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Transkrypcja doczytana do końca (znacznik końca widoczny w obszarze przewijania) - wysłuchane jak przy końcu nagrania.
  useEffect(() => {
    const end = endRef.current;
    if (!transcriptOpen || !end || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onHeardRef.current();
    });
    observer.observe(end);
    return () => observer.disconnect();
  }, [transcriptOpen]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (audio.ended) audio.currentTime = 0;
      audio.play().catch(() => {});
    } else audio.pause();
  }

  function trapTab(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={media.title}
      data-testid="osint-player"
      onKeyDown={trapTab}
      className="absolute inset-0 z-20 flex min-h-0 flex-col gap-2 rounded-card border border-border bg-surface p-3 shadow-card sm:p-4"
    >
      <div className="flex shrink-0 items-start gap-2">
        <h3 className="min-w-0 flex-1 text-base font-bold text-ink">{media.title}</h3>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Zamknij nagranie"
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink hover:bg-paper ${FOCUS_RING}`}
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      {transcriptOpen ? (
        <div role="region" aria-label="Transkrypcja" tabIndex={0} data-testid="osint-transcript" className={`min-h-0 flex-1 overflow-y-auto rounded-card bg-paper p-3 text-ink ${FOCUS_RING}`}>
          <p className="whitespace-pre-line">{media.narration.text}</p>
          <p ref={endRef} data-testid="osint-transcript-end" aria-hidden="true" className="h-px" />
        </div>
      ) : (
        imageUrl && (
          <div className="zoom-layer-frame flex min-h-0 flex-1 items-center justify-center">
            <div className="zoom-layer-box relative" style={{ '--scene-ratio': '1.7778', aspectRatio: 'var(--scene-ratio)' } as CSSProperties}>
              {/* eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src) */}
              <img src={imageUrl} alt={media.alt ?? ''} referrerPolicy="no-referrer" className="block h-full w-full object-contain" />
              <TextLayer items={media.textLayer} portrait={portrait && !!media.imagePortrait} />
            </div>
          </div>
        )
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {audioUrl && (
          <>
            <audio
              ref={audioRef}
              src={audioUrl}
              preload="metadata"
              hidden
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(event) => {
                const { currentTime, duration } = event.currentTarget;
                if (duration > 0) setProgress(currentTime / duration);
              }}
              onEnded={() => {
                setPlaying(false);
                setProgress(1);
                onHeardRef.current();
              }}
            />
            <button
              type="button"
              data-testid="osint-player-toggle"
              onClick={togglePlay}
              aria-label={playing ? 'Wstrzymaj nagranie' : 'Odtwórz nagranie'}
              className={`flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white shadow-card hover:bg-accent/90 ${FOCUS_RING}`}
            >
              {playing ? <Pause aria-hidden="true" className="h-5 w-5" /> : <Play aria-hidden="true" className="h-5 w-5 translate-x-0.5" />}
            </button>
            <div
              role="progressbar"
              aria-label="Postęp nagrania"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              className="h-2 min-w-[6rem] flex-1 overflow-hidden rounded-full bg-border"
            >
              <div className="h-full bg-accent" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <button
              type="button"
              onClick={() => setTranscriptOpen((open) => !open)}
              aria-pressed={transcriptOpen}
              className={`min-h-[44px] rounded-btn border border-border px-3 text-sm font-semibold text-ink hover:bg-paper ${FOCUS_RING}`}
            >
              Transkrypcja
            </button>
          </>
        )}
        {heard && media.secretEnding && (
          <p data-testid="osint-secret-ending" className="inline-flex items-center gap-2 text-sm font-bold text-accent-ink">
            <Award aria-hidden="true" className="h-5 w-5 shrink-0" />
            {media.secretEnding.label}
          </p>
        )}
      </div>
    </div>
  );
}
