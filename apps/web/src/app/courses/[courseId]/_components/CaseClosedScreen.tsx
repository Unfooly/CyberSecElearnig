'use client';

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import type { BriefingRect, CaseClosing, CourseCompletionReward, EvidenceSummary } from '@/lib/courses-types';
import { contentAssetUrl, withStaticFragment } from '@/lib/content-assets';
import { useSfx } from '@/lib/sfx';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';

// Ekran zamknięcia sprawy (feat/case-closed, D-089) - zastępuje dawny ekran ukończenia (SummaryScreen). Raport końcowy w teczce (scena
// 16:9 z treści modułu, SUMMARY.closing) z HTML w slotach sceny. Przebieg przy świeżym ukończeniu:
//   1. paper.mp3, teczka pojawia się z lekkim zoomem, liczby nabijają się (dowody x/N, czas w minutach od startu przypisania, +XP; 900 ms);
//   2. wnioski śledczego (SUMMARY.lessons) wpisywane linijka po linijce;
//   3. pulsująca obwódka na "podpis" (przycisk "Podpisz raport") -> klik -> imię i inicjał nazwiska gracza jako podpis (~600 ms);
//   4. pieczęć spada na raport (scale 1.6 -> 1, 350 ms) + stamp.mp3 + drgnięcie teczki;
//   5. liścik komisarza wlatuje (-5°);
//   6. pod raportem "Wróć do biblioteki" i "Następna sprawa" (brak następnej - zamknięta teczka z kłódką, "wkrótce").
// Ukończenie i XP są zapisane już przy wejściu na ten ekran (ostatni blok) - podpis to ceremonia, nie warunek. reduced-motion i podgląd
// (powrót do ukończonego kursu, bez świeżej nagrody) - od razu stan końcowy, bez dźwięków. Moduł bez `closing` - prosty ekran z wynikiem.
// Telefon w pionie: raport jako panorama przewijana w poziomie (globals.css .closing-frame), ceremonia przesuwa widok do pieczęci.
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
  const libraryRef = useRef<HTMLAnchorElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
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
        play('stamp');
        // Panorama (telefon w pionie): widok przesuwa się na prawą kartkę, gdzie spada pieczęć i wlatuje liścik. Poza panoramą no-op.
        const frame = frameRef.current;
        const scene = sceneRef.current;
        if (frame && scene && frame.scrollWidth > frame.clientWidth + 1 && closing) {
          frame.scrollTo?.({ left: scene.offsetLeft + (scene.offsetWidth * closing.slots.stamp.x) / 100 - 16, behavior: 'smooth' });
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
    // Przycisk podpisu znika (zostaje sam podpis) - fokus na "Wróć do biblioteki", żeby klawiatura/czytnik nie spadły na body.
    libraryRef.current?.focus();
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
  const imageUrl = closing ? withStaticFragment(contentAssetUrl(contentBase, closing.image, 'image'), !ceremony) : null;
  const stampUrl = closing ? withStaticFragment(contentAssetUrl(contentBase, closing.stamp, 'image'), !ceremony) : null;
  const noteUrl = closing ? withStaticFragment(contentAssetUrl(contentBase, closing.note, 'image'), !ceremony) : null;
  const report = [
    hasEvidence ? `Dowody: ${evidence!.collected} z ${evidence!.total}.` : null,
    minutes !== null ? `Czas śledztwa: ${minutes} min.` : null,
    xp !== null ? `Zdobyte doświadczenie: ${xp} XP.` : null,
    lessons.length > 0 ? `Wnioski śledczego: ${lessons.join(' ')}` : null,
    // Podpis z inicjałem kończy się kropką ("Anna K.") - bez podwójnej.
    `Podpis prowadzącego: ${signer.replace(/\.$/, '')}.`,
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
  const badges = reward?.unlockedBadges.length ? `Nowe odznaki: ${reward.unlockedBadges.map((badge) => badge.title).join(', ')}.` : null;

  return (
    <div data-testid="case-closed" data-stage={stage} className="flex min-h-0 w-full flex-1 flex-col">
      <div className="mb-2 flex shrink-0 flex-wrap items-baseline justify-center gap-x-2 text-center">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-ink outline-none">
          Sprawa zamknięta
        </h2>
        <p className="text-sm font-medium text-muted">{title}</p>
      </div>
      <p className="sr-only">{report}</p>

      {closing && imageUrl ? (
        <div ref={frameRef} data-testid="case-closed-frame" className="closing-frame relative flex min-h-0 w-full flex-1">
          <div
            data-testid="case-closed-scene"
            ref={sceneRef}
            // Wejście teczki tylko na etapie intro: klasa zdjęta później nie wraca (inaczej po drgnięciu przeglądarka odpaliłaby wejście
            // teczki drugi raz - obie klasy ustawiają `animation`).
            className={`closing-box relative m-auto shrink-0 ${ceremony && stage === 'intro' ? 'closing-folder-in' : ''} ${ceremony && stage === 'stamp' ? 'closing-shake' : ''}`}
            style={{ aspectRatio: '16 / 9' }}
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
                style={{ ...place(closing.slots[slot]), fontSize: '2.2cqw', paddingLeft: '1cqw' }}
              >
                {value}
              </p>
            ))}

            <ol aria-hidden="true" data-testid="closing-lessons" className="absolute overflow-hidden text-ink" style={{ ...place(closing.slots.lessons), fontSize: '1.3cqw', lineHeight: '2.5cqw', paddingTop: '1.6cqw' }}>
              {shownLessons.map((line, index) =>
                line ? (
                  <li key={index} className="whitespace-nowrap">
                    {index + 1}. {line}
                  </li>
                ) : null,
              )}
            </ol>

            {/* Przycisk tylko na etapie podpisu; potem sam podpis (dla czytnika jest w opisie raportu wyżej). */}
            {stage === 'sign' ? (
              <button
                ref={signRef}
                type="button"
                aria-label="Podpisz raport"
                data-testid="closing-signature"
                onClick={sign}
                className="closing-sign-hit closing-sign-pulse absolute cursor-pointer rounded-[0.4cqw] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                style={place(closing.slots.signature)}
              />
            ) : (
              <div aria-hidden="true" data-testid="closing-signature" className="absolute flex items-end" style={place(closing.slots.signature)}>
                {signed && (
                  <span
                    className={`block whitespace-nowrap font-semibold italic text-accent-ink ${ceremony && stage === 'signing' ? 'closing-sign-draw' : ''}`}
                    style={{ fontSize: '2.4cqw', lineHeight: 1.1, paddingLeft: '1cqw' }}
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
                style={place(closing.slots.stamp)}
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
                style={{ ...place(closing.slots.note), transform: 'rotate(-5deg)' }}
              />
            )}
          </div>
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

      <div className="mt-2 flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <p className="text-sm text-muted">
          {scoreLine}
          {levelUp && <span className="ml-2 font-semibold text-accent-ink">{levelUp}</span>}
          {badges && <span className="ml-2">{badges}</span>}
        </p>
        {restartError && <p className="text-sm font-medium text-danger">Nie udało się rozpocząć kursu od nowa. Spróbuj ponownie.</p>}
        <Link
          ref={libraryRef}
          href="/courses"
          className="inline-flex min-h-[44px] items-center rounded-btn bg-ink px-4 text-sm font-bold text-white hover:bg-ink/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Wróć do biblioteki
        </Link>
        {/* Kolejnej sprawy w API jeszcze nie ma (B-115) - zamknięta teczka z kłódką. aria-disabled (nie disabled): osiągalny Tabem,
            więc użytkownik klawiatury/czytnika też usłyszy "wkrótce"; bez obsługi kliku (type=button poza formularzem nic nie robi). */}
        <button
          type="button"
          aria-disabled="true"
          className="inline-flex min-h-[44px] cursor-not-allowed items-center gap-2 rounded-btn border border-border bg-paper px-4 text-sm font-bold text-muted"
        >
          <Lock aria-hidden="true" className="h-4 w-4" />
          Następna sprawa · wkrótce
        </button>
      </div>
    </div>
  );
}
