'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Lock, Trophy } from 'lucide-react';
import type { BriefingRect, CaseClosing, CourseCompletionReward, EvidenceSummary } from '@/lib/courses-types';
import { contentAssetUrl, withStaticFragment } from '@/lib/content-assets';
import { useSfx } from '@/lib/sfx';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { usePortraitContainer } from '@/lib/use-portrait-container';

// Ekran zamknięcia sprawy (feat/case-closed, D-089) - zastępuje dawny ekran ukończenia (SummaryScreen). Raport końcowy w teczce (scena
// 16:9 z treści modułu, SUMMARY.closing) z HTML w slotach sceny. Przebieg przy świeżym ukończeniu:
//   1. paper.mp3, teczka pojawia się z lekkim zoomem, liczby nabijają się (dowody x/N, czas w minutach od startu przypisania, +XP; 900 ms);
//   2. wnioski śledczego (SUMMARY.lessons) wpisywane linijka po linijce;
//   3. pulsująca obwódka na "podpis" (przycisk "Podpisz raport") -> klik -> imię i inicjał nazwiska gracza jako podpis (~600 ms);
//   4. pieczęć spada na raport (scale 1.6 -> 1, 350 ms) + stamp.mp3 + drgnięcie teczki;
//   5. liścik komisarza wlatuje (-5°);
//   6. pod raportem "Następna sprawa" (brak następnej - zamknięta teczka z kłódką, "wkrótce"); "Wróć do biblioteki" jest przyciskiem
//      „Dalej” dolnego paska (D-106 - jeden przycisk dalej w całym odtwarzaczu).
// Ukończenie i XP są zapisane już przy wejściu na ten ekran (ostatni blok) - podpis to ceremonia, nie warunek. reduced-motion i podgląd
// (powrót do ukończonego kursu, bez świeżej nagrody) - od razu stan końcowy, bez dźwięków. Moduł bez `closing` - prosty ekran z wynikiem.
// Telefon w pionie: z `closing.portrait` w treści (D-098, D-107) - pionowy raport jako jedna duża strona 9:16 wypełniająca wolną
// wysokość (contain), WSZYSTKIE dane w slotach grafiki (liczby 18 px pogrubione, podpis min. 16 px, wnioski min. 15 px), pod sceną tylko
// „Następna sprawa · wkrótce”; bez niego raport jako panorama przewijana w poziomie (globals.css .closing-frame), ceremonia przesuwa
// widok do pieczęci.
// Ogłoszenie zdobytego XP żyje w PlayerStage (region persystentny, D-076) - tu tylko pełny opis raportu dla czytnika.

type Stage = 'intro' | 'lessons' | 'sign' | 'signing' | 'stamp' | 'note' | 'done';
const INTRO_MS = 1300;
const COUNT_MS = 900;
const CHAR_MS = 28;
const LINE_PAUSE_MS = 220;
const SIGN_MS = 600;
const STAMP_MS = 450;
const NOTE_MS = 600;

/** Czas śledztwa w minutach (co najmniej 1) od pierwszego startu do ukończenia; null, gdy któregoś momentu nie znamy. */
export function caseMinutes(startedAt: string | null | undefined, completedAt: string | null | undefined): number | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.max(1, Math.round(ms / 60000));
}

function useCountUp(target: number, active: boolean, delayMs: number): number {
  const [value, setValue] = useState(active ? 0 : target);
  useEffect(() => {
    if (!active) {
      setValue(target);
      return undefined;
    }
    let frame = 0;
    const startAt = performance.now() + delayMs;
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - startAt) / COUNT_MS));
      setValue(Math.round(target * progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active, delayMs]);
  return value;
}

const place = (rect: BriefingRect): CSSProperties => ({ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` });

const CONFETTI_MS = 1200;
const CONFETTI_COLORS = ['var(--accent)', 'var(--accent-soft)', 'var(--success)', 'var(--highlight)'];

/** Kierunki i obroty (max 30) cząstek - deterministycznie (bez Math.random: ten sam wygląd przy każdym renderze i w testach). */
function confettiPieces(count = 30): { dx: number; dy: number; rot: number; color: string; size: number }[] {
  const n = Math.min(count, 30);
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2 + (i % 3) * 0.35;
    const distance = 14 + ((i * 37) % 11);
    return {
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance - 6,
      rot: ((i * 53) % 360) - 180,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 0.8 + ((i * 7) % 5) * 0.15,
    };
  });
}

/**
 * Jednorazowe konfetti przy pieczęci (D-090, B-116): max 30 cząstek w kolorach marki, 1,2 s, wyłącznie transform/opacity, w obrębie ramki
 * raportu (własna warstwa z overflow-hidden); aria-hidden. Renderowane tylko w ceremonii bez reduced-motion (decyduje wywołujący; CSS i tak pod no-preference).
 */
function Confetti({ at }: { at: BriefingRect }) {
  // Warstwa na cały raport, przycinana do niego: cząstki nie wychodzą na nagłówek/przyciski ani nie poszerzają przewijania panoramy.
  return (
    <div aria-hidden="true" data-testid="closing-confetti" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute" style={{ left: `${at.x + at.w / 2}%`, top: `${at.y + at.h / 2}%` }}>
        {confettiPieces().map((piece, index) => (
          <span
            key={index}
            className="closing-confetti-piece absolute rounded-[1px]"
            style={
              {
                width: `${piece.size}cqw`,
                height: `${piece.size * 0.5}cqw`,
                background: piece.color,
                '--dx': `${piece.dx}cqw`,
                '--dy': `${piece.dy}cqw`,
                '--rot': `${piece.rot}deg`,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}

// Toast nagrody na telefonie w pionie (B-127): awans poziomu i nowe odznaki są wzrokowo widoczne (spod pionowego raportu zniknął pasek
// poziomu, D-107) - na REWARD_TOAST_MS nad dolnym paskiem, po ceremonii. Styl jak karta trofeum (ciemny indygo, złota ikona).
// reduced-motion: bez animacji (pojawia się i znika). Dla czytnika nagroda jest w opisie raportu - toast jest aria-hidden (bez dubla).
export const REWARD_TOAST_MS = 2500;

function RewardToast({ levelUp, badges, show, animate }: { levelUp: string | null; badges: string[]; show: boolean; animate: boolean }) {
  const hasReward = !!levelUp || badges.length > 0;
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState(false);
  // Raz: pokazanie i schowanie to osobne efekty (zmiana `shown` nie może skasować timera chowania).
  useEffect(() => {
    if (!show || !hasReward || shown) return;
    setShown(true);
    setVisible(true);
  }, [show, hasReward, shown]);
  useEffect(() => {
    if (!visible) return undefined;
    const timer = window.setTimeout(() => setVisible(false), REWARD_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);
  if (!visible) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="reward-toast"
      className={`pointer-events-none absolute inset-x-3 bottom-3 z-20 mx-auto flex max-w-sm items-center gap-3 rounded-card bg-[#261D7A] px-4 py-3 text-white shadow-card ${animate ? 'motion-safe:animate-rise-in' : ''}`}
    >
      <Trophy aria-hidden="true" className="h-7 w-7 shrink-0 text-[#FFD36E]" />
      <div className="min-w-0 text-[15px] leading-snug">
        {levelUp && <p className="font-extrabold">{levelUp}</p>}
        {badges.length > 0 && <p className="font-semibold text-white/90">{badges.length === 1 ? `Nowa odznaka: ${badges[0]}` : `Nowe odznaki: ${badges.join(', ')}`}</p>}
      </div>
    </div>
  );
}

/** Pasek poziomu (D-090, B-116): wypełnienie przesuwa się od stanu sprzed nagrody do stanu po (translateX, 600 ms); reduced-motion - od razu. */
function LevelProgress({ reward, animate }: { reward: CourseCompletionReward; animate: boolean }) {
  const [grown, setGrown] = useState(!animate);
  useEffect(() => {
    if (!animate) return undefined;
    const timer = window.setTimeout(() => setGrown(true), 300);
    return () => window.clearTimeout(timer);
  }, [animate]);
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  // Bez animacji (także reduced-motion włączone w trakcie pierwszych 300 ms) - od razu stan po nagrodzie.
  const percent = clamp(!animate || grown ? reward.levelProgressAfterPercent : reward.levelProgressBeforePercent);
  const labelId = useId();
  return (
    <div className="flex items-center gap-2 text-xs font-bold text-muted">
      <span id={labelId}>Poziom {reward.previousLevel}</span>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamp(reward.levelProgressAfterPercent)}
        className="h-1.5 w-24 overflow-hidden rounded-full bg-border"
      >
        <div
          data-testid="level-progress-fill"
          className="h-full w-full rounded-full bg-accent motion-safe:transition-transform motion-safe:duration-[600ms] motion-safe:ease-out-soft"
          style={{ transform: `translateX(${percent - 100}%)` }}
        />
      </div>
    </div>
  );
}

export default function CaseClosedScreen({
  title,
  score,
  scoreUnavailable = false,
  reward = null,
  restartError = false,
  headingRef,
  closing,
  lessons = [],
  evidence,
  startedAt,
  completedAt,
  signer,
  contentBase,
  fresh,
}: {
  title: string;
  score: number | null;
  scoreUnavailable?: boolean;
  /** Obecne WYŁĄCZNIE przy świeżym ukończeniu w tej sesji (odpowiedź /progress). */
  reward?: CourseCompletionReward | null;
  restartError?: boolean;
  headingRef?: RefObject<HTMLHeadingElement>;
  /** Grafika i sloty z SUMMARY.closing; brak = prosty ekran. */
  closing?: CaseClosing;
  lessons?: string[];
  evidence?: EvidenceSummary | null;
  startedAt?: string | null;
  completedAt?: string | null;
  /** Podpis prowadzącego: imię i inicjał nazwiska gracza (z sesji). */
  signer: string;
  contentBase: string;
  /** Ukończenie w tej sesji (ceremonia z animacją i dźwiękami); false - powrót do ukończonego kursu (stan końcowy od razu). */
  fresh: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const play = useSfx(['paper', 'stamp']);
  // Stan końcowy od razu: powrót do ukończonego kursu albo reduced-motion (czytane przy montowaniu - bez mrugnięcia ceremonii).
  // Bezpieczne dla hydratacji tylko dlatego, że przy SSR `fresh` jest zawsze false (świeże ukończenie powstaje wyłącznie w przeglądarce,
  // po odpowiedzi /progress) - inicjalizator nie czyta wtedy window. Bez `closing` (prosty ekran) nie ma ceremonii.
  const [animated] = useState(() => !!closing && fresh && !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  const ceremony = animated && !reducedMotion;
  const [stage, setStage] = useState<Stage>(ceremony ? 'intro' : 'done');
  const [typedChars, setTypedChars] = useState(ceremony ? 0 : Number.POSITIVE_INFINITY);
  const signRef = useRef<HTMLButtonElement>(null);
  // Orientacja (D-098) z proporcji CAŁEGO ekranu zamknięcia (korzeń, flex-1), nie ramki raportu - wysokość ramki zależy od układu
  // przycisków pod nią, który sam zależy od orientacji (sprzężenie). < 0.8 i `closing.portrait` w treści -> raport pionowy 9:16 zamiast
  // panoramy 16:9; obrót telefonu przełącza wariant bez utraty etapu ceremonii (stan poniżej nie zależy od orientacji).
  const [rootRef, portraitRoot] = usePortraitContainer<HTMLDivElement>();
  // Do pierwszego pomiaru (null - także HTML z serwera) raport się nie renderuje - bez mignięcia panoramy i pobierania poziomej grafiki.
  const measured = portraitRoot !== null;
  const portrait = portraitRoot === true && !!closing?.portrait;
  const frameRef = useRef<HTMLDivElement>(null);
  // Raport w bieżącej orientacji: obraz i sloty. Rozmiary tekstu w cqw skalowane do szerokości sceny (pionowa ma 900 zamiast 1600 j.).
  const sceneImage = portrait ? closing!.portrait!.image : closing?.image;
  const slots = portrait ? closing!.portrait!.slots : closing?.slots;
  const k = portrait ? 1600 / 900 : 1;
  const cqw = (value: number) => `${(value * k).toFixed(3)}cqw`;
  // Pionowo (telefon, D-107) tekst w slotach ma dolną granicę czytelności: liczby 18 px, podpis 16 px, wnioski 15 px (wnioski w slocie
  // z overflow-hidden - bardzo długie wnioski innego modułu mogłyby się uciąć; layout-check pilnuje modułu 1, limit w treści: B-127).
  const font = (value: number, minPx: number) => (portrait ? `max(${minPx}px, ${cqw(value)})` : cqw(value));
  // Konfetti przy pieczęci - raz, na CONFETTI_MS (potem cząstki znikają z DOM).
  const [confetti, setConfetti] = useState(false);
  useEffect(() => {
    if (!confetti) return undefined;
    const timer = window.setTimeout(() => setConfetti(false), CONFETTI_MS);
    return () => window.clearTimeout(timer);
  }, [confetti]);
  const sceneRef = useRef<HTMLDivElement>(null);
  const minutes = caseMinutes(startedAt, completedAt);
  // Ponowne ukończenie po restarcie nie dolicza XP (0) - "—" zamiast "+0".
  const xp = reward?.xpGained ? reward.xpGained : null;

  // reduced-motion włączone w trakcie ceremonii: od razu stan końcowy (bez pół-stanu).
  useEffect(() => {
    if (ceremony) return;
    setStage('done');
    setTypedChars(Number.POSITIVE_INFINITY);
  }, [ceremony]);
  const hasEvidence = !!evidence && evidence.total > 0;
  const evidenceCount = useCountUp(evidence?.collected ?? 0, ceremony, 300);
  const minutesCount = useCountUp(minutes ?? 0, ceremony, 300);
  const xpCount = useCountUp(xp ?? 0, ceremony, 300);
  const totalChars = lessons.reduce((sum, line) => sum + line.length, 0);
  const signed = stage === 'signing' || stage === 'stamp' || stage === 'note' || stage === 'done';
  const stamped = stage === 'stamp' || stage === 'note' || stage === 'done';
  const noted = stage === 'note' || stage === 'done';

  useEffect(() => {
    if (!ceremony) return undefined;
    play('paper');
    const timer = window.setTimeout(() => setStage('lessons'), INTRO_MS);
    return () => window.clearTimeout(timer);
    // Jednorazowo przy wejściu na ekran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wnioski linijka po linijce: znak po znaku, krótka pauza na końcu linii; potem czekamy na podpis.
  useEffect(() => {
    if (stage !== 'lessons') return undefined;
    if (typedChars >= totalChars) {
      setStage('sign');
      return undefined;
    }
    let consumed = 0;
    let atLineEnd = false;
    for (const line of lessons) {
      consumed += line.length;
      if (typedChars === consumed) atLineEnd = true;
    }
    const timer = window.setTimeout(() => setTypedChars((count) => count + 1), atLineEnd && typedChars > 0 ? LINE_PAUSE_MS : CHAR_MS);
    return () => window.clearTimeout(timer);
  }, [stage, typedChars, totalChars, lessons]);

  useEffect(() => {
    if (stage === 'sign') signRef.current?.focus();
    if (stage === 'signing') {
      const timer = window.setTimeout(() => {
        setStage('stamp');
        setConfetti(true);
        play('stamp');
        // Panorama (telefon w pionie): widok przesuwa się na prawą kartkę, gdzie spada pieczęć i wlatuje liścik. Poza panoramą no-op.
        const frame = frameRef.current;
        const scene = sceneRef.current;
        if (frame && scene && frame.scrollWidth > frame.clientWidth + 1 && slots) {
          frame.scrollTo?.({ left: scene.offsetLeft + (scene.offsetWidth * slots.stamp.x) / 100 - 16, behavior: 'smooth' });
        }
      }, SIGN_MS);
      return () => window.clearTimeout(timer);
    }
    if (stage === 'stamp') {
      const timer = window.setTimeout(() => setStage('note'), STAMP_MS);
      return () => window.clearTimeout(timer);
    }
    if (stage === 'note') {
      const timer = window.setTimeout(() => setStage('done'), NOTE_MS);
      return () => window.clearTimeout(timer);
    }
    return undefined;
    // play - stabilna funkcja z useSfx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  function sign() {
    if (stage !== 'sign') return;
    setStage('signing');
    // Przycisk podpisu znika (zostaje sam podpis) - fokus na "Wróć do biblioteki" w dolnym pasku (D-106), żeby klawiatura/czytnik nie
    // spadły na body.
    document.querySelector<HTMLElement>('[data-testid="player-bottombar"] .pbar-next')?.focus();
  }

  const scoreLine = scoreUnavailable ? (
    'Nie udało się pobrać wyniku. Spróbuj odświeżyć stronę.'
  ) : score !== null ? (
    <>
      Wynik zadań: <strong className="font-bold text-ink">{score}%</strong>
    </>
  ) : (
    'Ten kurs nie zawierał ocenianych pytań.'
  );
  const imageUrl = closing ? withStaticFragment(contentAssetUrl(contentBase, sceneImage, 'image'), !ceremony) : null;
  const stampUrl = closing ? withStaticFragment(contentAssetUrl(contentBase, closing.stamp, 'image'), !ceremony) : null;
  const noteUrl = closing ? withStaticFragment(contentAssetUrl(contentBase, closing.note, 'image'), !ceremony) : null;
  const report = [
    hasEvidence ? `Dowody: ${evidence!.collected} z ${evidence!.total}.` : null,
    minutes !== null ? `Czas śledztwa: ${minutes} min.` : null,
    xp !== null ? `Zdobyte doświadczenie: ${xp} XP.` : null,
    lessons.length > 0 ? `Wnioski śledczego: ${lessons.join(' ')}` : null,
    // Podpis z inicjałem kończy się kropką ("Anna K.") - bez podwójnej.
    `Podpis prowadzącego: ${signer.replace(/\.$/, '')}.`,
    // Pionowo (D-107) pod raportem nie ma linijki wyniku, paska poziomu ani odznak - wynik, awans i nowe odznaki są w opisie raportu
    // dla czytnika (błąd pobrania wyniku jest też widoczny pod raportem).
    portrait && !scoreUnavailable && score !== null ? `Wynik zadań: ${score}%.` : null,
    portrait && reward?.leveledUp ? `Awans na poziom ${reward.newLevel}.` : null,
    portrait && (reward?.unlockedBadges?.length ?? 0) > 0 ? `Nowe osiągnięcia: ${reward!.unlockedBadges.map((badge) => badge.title).join(', ')}.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  // Wnioski do pokazania (przy ceremonii - tylko wystukana część).
  let remaining = typedChars;
  const shownLessons = lessons.map((line) => {
    const visible = line.slice(0, Math.max(0, remaining));
    remaining -= line.length;
    return visible;
  });

  const levelUp = reward?.leveledUp ? `Awans na poziom ${reward.newLevel}!` : null;
  const newBadges = reward?.unlockedBadges ?? [];

  return (
    <div ref={rootRef} data-testid="case-closed" data-stage={stage} className="relative flex min-h-0 w-full flex-1 flex-col">
      {portrait && <RewardToast levelUp={levelUp} badges={newBadges.map((badge) => badge.title)} show={stage === 'done'} animate={ceremony} />}
      <div className="mb-2 flex shrink-0 flex-wrap items-baseline justify-center gap-x-2 text-center">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-ink outline-none">
          Sprawa zamknięta
        </h2>
        <p className="text-sm font-medium text-muted">{title}</p>
      </div>
      <p className="sr-only">{report}</p>

      {closing && imageUrl && slots ? (
        <div ref={frameRef} data-testid="case-closed-frame" data-orientation={portrait ? 'portrait' : 'landscape'} className="closing-frame relative flex min-h-0 w-full flex-1">
          {measured && (
          <div
            data-testid="case-closed-scene"
            ref={sceneRef}
            // Wejście teczki tylko na etapie intro: klasa zdjęta później nie wraca (inaczej po drgnięciu przeglądarka odpaliłaby wejście
            // teczki drugi raz - obie klasy ustawiają `animation`).
            className={`closing-box relative m-auto shrink-0 ${ceremony && stage === 'intro' ? 'closing-folder-in' : ''} ${ceremony && stage === 'stamp' ? 'closing-shake' : ''}`}
            style={{ aspectRatio: portrait ? '9 / 16' : '16 / 9' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- zasób modułu z CONTENT_BASE_URL, SVG tylko przez <img> (D-051) */}
            <img src={imageUrl} alt="" referrerPolicy="no-referrer" className="absolute inset-0 block h-full w-full object-contain" />

            {(
              [
                ['evidence', hasEvidence ? `${evidenceCount}/${evidence!.total}` : '—'],
                ['time', minutes !== null ? `${minutesCount} min` : '—'],
                ['xp', xp !== null ? `+${xpCount}` : '—'],
              ] as const
            ).map(([slot, value]) => (
              <p
                key={slot}
                aria-hidden="true"
                data-testid={`closing-${slot}`}
                className="absolute flex items-center whitespace-nowrap font-extrabold tabular-nums text-ink"
                style={{ ...place(slots[slot]), fontSize: font(2.2, 18), paddingLeft: cqw(1) }}
              >
                {value}
              </p>
            ))}

            {/* Wnioski w slocie raportu. Pionowo (D-107) min. 15 px i zawijane (duża strona raportu); każda linijka rezerwuje wysokość
                pełnego tekstu (niewidoczna kopia w tej samej komórce siatki), więc wystukiwanie nie przesuwa kolejnych linijek. */}
            {portrait ? (
              <ol aria-hidden="true" data-testid="closing-lessons" className="absolute flex flex-col overflow-hidden text-ink" style={{ ...place(slots.lessons), fontSize: font(1.3, 15), lineHeight: 1.25, gap: cqw(0.3) }}>
                {lessons.map((line, index) => (
                  <li key={index} className="grid">
                    <span className="invisible col-start-1 row-start-1">
                      {index + 1}. {line}
                    </span>
                    <span data-testid="closing-lesson-typed" className="col-start-1 row-start-1">
                      {shownLessons[index] ? `${index + 1}. ${shownLessons[index]}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <ol aria-hidden="true" data-testid="closing-lessons" className="absolute overflow-hidden text-ink" style={{ ...place(slots.lessons), fontSize: cqw(1.3), lineHeight: cqw(2.5), paddingTop: cqw(1.6) }}>
                {shownLessons.map((line, index) =>
                  line ? (
                    <li key={index} className="whitespace-nowrap">
                      {index + 1}. {line}
                    </li>
                  ) : null,
                )}
              </ol>
            )}

            {/* Przycisk tylko na etapie podpisu; potem sam podpis (dla czytnika jest w opisie raportu wyżej). */}
            {stage === 'sign' ? (
              <button
                ref={signRef}
                type="button"
                aria-label="Podpisz raport"
                data-testid="closing-signature"
                onClick={sign}
                className="closing-sign-hit closing-sign-pulse absolute cursor-pointer rounded-[0.4cqw] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                style={place(slots.signature)}
              />
            ) : (
              <div aria-hidden="true" data-testid="closing-signature" className="absolute flex items-end" style={place(slots.signature)}>
                {signed && (
                  <span
                    data-testid="closing-signed"
                    className={`block whitespace-nowrap font-semibold italic text-accent-ink ${ceremony && stage === 'signing' ? 'closing-sign-draw' : ''}`}
                    style={{ fontSize: font(2.4, 16), lineHeight: 1.1, paddingLeft: cqw(1) }}
                  >
                    {signer}
                  </span>
                )}
              </div>
            )}

            {stamped && stampUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- jak wyżej
              <img
                src={stampUrl}
                alt=""
                referrerPolicy="no-referrer"
                data-testid="closing-stamp"
                className={`absolute object-contain ${ceremony ? 'closing-stamp-in' : ''}`}
                style={place(slots.stamp)}
              />
            )}
            {noted && noteUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- jak wyżej
              <img
                src={noteUrl}
                alt=""
                referrerPolicy="no-referrer"
                data-testid="closing-note"
                className={`absolute object-contain ${ceremony ? 'closing-note-in' : ''}`}
                style={{ ...place(slots.note), transform: 'rotate(-5deg)' }}
              />
            )}
            {confetti && ceremony && <Confetti at={slots.stamp} />}
          </div>
          )}
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center rounded-card bg-surface p-8 text-center">
          {xp !== null && <p className="text-2xl font-bold text-accent-ink">+{xp} XP</p>}
          {hasEvidence && (
            <p className="mt-2 text-muted">
              Zebrane dowody: {evidence!.collected} z {evidence!.total}
            </p>
          )}
        </div>
      )}

      {/* Pod raportem: poziomo - wynik zadań, poziom, odznaki i „Następna sprawa”; pionowo (D-107) TYLKO „Następna sprawa” na pełną
          szerokość (dane są na grafice, wynik zadań - w opisie raportu dla czytnika; „Wróć do biblioteki” - w dolnym pasku, D-106). */}
      <div
        data-testid="case-closed-actions"
        className={`mt-2 flex shrink-0 gap-y-2 ${portrait ? 'flex-col items-stretch text-center' : 'flex-wrap items-center justify-center gap-x-4'}`}
      >
        {!portrait && (
          <p className="text-sm text-muted">
            {scoreLine}
            {levelUp && <span className="ml-2 font-semibold text-accent-ink">{levelUp}</span>}
          </p>
        )}
        {reward && !portrait && <LevelProgress reward={reward} animate={ceremony} />}
        {newBadges.length > 0 && !portrait && (
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
            {/* Wąski ekran: jedna zbiorcza plakietka (wiersz nazw odznak odbierałby wysokość raportowi); od sm - każda odznaka osobno. */}
            <span
              aria-hidden="true"
              className={`inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent-ink sm:hidden ${ceremony ? 'motion-safe:animate-badge-pop' : ''}`}
              style={ceremony ? { animationDelay: '600ms' } : undefined}
            >
              {newBadges.length === 1 ? 'Nowe osiągnięcie' : `Nowe osiągnięcia: ${newBadges.length}`}
            </span>
            <span className="sr-only sm:not-sr-only">Nowe osiągnięcia:</span>
            {newBadges.map((badge, index) => (
              // Pop odznaki (D-090, B-116): .6 -> 1.08 -> 1, kolejne z opóźnieniem; reduced-motion - od razu. Na wąskim ekranie tylko dla czytnika.
              <span
                key={badge.code}
                className={`sr-only sm:not-sr-only sm:inline-flex sm:items-center sm:rounded-full sm:bg-accent-soft sm:px-2 sm:py-0.5 sm:text-xs sm:font-bold sm:text-accent-ink ${ceremony ? 'motion-safe:animate-badge-pop' : ''}`}
                style={ceremony ? { animationDelay: `${600 + index * 120}ms` } : undefined}
              >
                {badge.title}
              </span>
            ))}
          </p>
        )}
        {/* Błąd pobrania wyniku to nie dubel danych z grafiki - pionowo też widoczny (poziomo jest w linijce wyniku wyżej). */}
        {portrait && scoreUnavailable && <p className="text-sm font-medium text-danger">Nie udało się pobrać wyniku. Spróbuj odświeżyć stronę.</p>}
        {restartError && <p className="text-sm font-medium text-danger">Nie udało się rozpocząć kursu od nowa. Spróbuj ponownie.</p>}
        {/* Kolejnej sprawy w API nie ma (B-115: zachowanie MVP) - zamknięta teczka z kłódką. aria-disabled (nie disabled): osiągalny Tabem,
            więc użytkownik klawiatury/czytnika też usłyszy "wkrótce"; bez obsługi kliku (type=button poza formularzem nic nie robi). */}
        <button
          type="button"
          aria-disabled="true"
          className="inline-flex min-h-[44px] cursor-not-allowed items-center justify-center gap-2 rounded-btn border border-border bg-paper px-4 text-sm font-bold text-muted"
        >
          <Lock aria-hidden="true" className="h-4 w-4" />
          Następna sprawa · wkrótce
        </button>
      </div>
    </div>
  );
}
