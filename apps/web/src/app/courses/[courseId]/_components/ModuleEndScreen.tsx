'use client';

import { useEffect, useId, useState, type RefObject } from 'react';
import Link from 'next/link';
import { ChevronRight, Lock, Trophy, X } from 'lucide-react';
import { contentAssetUrl } from '@/lib/content-assets';
import type { CourseCompletionReward, ModuleInfo } from '@/lib/courses-types';
import { caseMinutes } from './CaseClosedScreen';
import { SimpleInline } from './simple-markdown';

// Ekran końca modułu (szablon modułu Unfooly, D-165) - zastępuje raport w teczce (CaseClosedScreen) w odpowiedziach z danymi modułu.
// Komputer (≥ 640 px): okładka „po sprawie” (`cover.end`) na tle, jasny panel z lewej (~60%, zaokrąglona prawa krawędź): pieczątka
// SPRAWA ZAMKNIĘTA i tytuł modułu, nagłówek (tytuł bloku SUMMARY), trzy kafelki (wynik, czas, punkty), poziom z paskiem i nowym
// osiągnięciem (tylko przy świeżym ukończeniu - wtedy znamy nagrodę), zasady na wynos i przyciski: „Następna sprawa”, „Wróć do
// biblioteki”, link „Zagraj jeszcze raz”. Telefon: okładka u góry (`endPortrait`, bez niej wykadrowana pozioma), karta pod nią. Brak
// okładki - tło #23232A. Bez paska postępu i dolnego paska (makieta) - to nie jest blok kursu.

export interface ModuleEndScreenProps {
  moduleTitle: string;
  /** Nagłówek - tytuł bloku SUMMARY (np. „Drzwi zamknięte”); bez niego „Sprawa zamknięta”. */
  headline?: string;
  info: ModuleInfo;
  contentBase: string;
  /** Język treści (D-133) - `lang` nagłówka i zasad. */
  lang: string;
  score: number | null;
  scoreUnavailable?: boolean;
  /** Obecne WYŁĄCZNIE przy świeżym ukończeniu w tej sesji (odpowiedź /progress); bez niego - bez karty poziomu i „—” w punktach. */
  reward?: CourseCompletionReward | null;
  startedAt?: string | null;
  completedAt?: string | null;
  rules: string[];
  nextCourse?: { courseId: string; title: string } | null;
  onRestart: () => void;
  restarting?: boolean;
  restartError?: boolean;
  headingRef?: RefObject<HTMLHeadingElement>;
  /** Ukończenie w tej sesji - pieczątka „wbija się” (bez reduced-motion). */
  fresh?: boolean;
}

export default function ModuleEndScreen({
  moduleTitle,
  headline,
  info,
  contentBase,
  lang,
  score,
  scoreUnavailable = false,
  reward = null,
  startedAt,
  completedAt,
  rules,
  nextCourse = null,
  onRestart,
  restarting = false,
  restartError = false,
  headingRef,
  fresh = false,
}: ModuleEndScreenProps) {
  const landscape = contentAssetUrl(contentBase, info.cover?.end, 'image');
  const portrait = contentAssetUrl(contentBase, info.cover?.endPortrait ?? undefined, 'image');
  const minutes = caseMinutes(startedAt, completedAt);
  // Ponowne ukończenie po restarcie nie dolicza XP (0) - „—” zamiast „+0”.
  const xp = reward?.xpGained ? reward.xpGained : null;
  const badges = reward?.unlockedBadges ?? [];

  // Ogłoszenie wyniku dla czytnika (jak dotąd w PlayerStage, D-076): region obecny od montowania, wypełniany po nim - czytnik ogłasza zmianę
  // treści regionu, a nie region wstawiony już z treścią.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (!reward) return;
    setAnnouncement(
      reward.xpGained > 0
        ? `Kurs ukończony. Zdobyto ${reward.xpGained} punktów doświadczenia.`
        : 'Kurs ukończony ponownie. Punkty doświadczenia naliczone przy pierwszym ukończeniu.',
    );
  }, [reward]);

  const tiles: [string, string, boolean][] = [
    ['Wynik', scoreUnavailable || score === null ? '—' : `${score}%`, false],
    ['Czas', minutes !== null ? `${minutes} min` : '—', false],
    // Fiolet tylko dla zdobytych punktów (makieta) - „—” zwykłym kolorem.
    ['Punkty', xp !== null ? `+${xp}` : '—', xp !== null],
  ];

  return (
    <div data-testid="module-end" className="relative flex h-dvh flex-col overflow-hidden bg-[#23232A] text-ink">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {landscape && (
        <picture>
          {portrait && <source media="(max-width: 639px)" srcSet={portrait} />}
          {/* eslint-disable-next-line @next/next/no-img-element -- zasób modułu z CONTENT_BASE_URL, SVG tylko przez <img> (D-051) */}
          <img
            src={landscape}
            alt=""
            data-testid="module-end-cover"
            referrerPolicy="no-referrer"
            className="absolute inset-x-0 top-0 h-[34%] w-full object-cover object-[75%_50%] sm:inset-0 sm:h-full sm:object-center"
          />
        </picture>
      )}

      {/* Jasny panel z lewej (komputer): zaokrąglona prawa krawędź jak na ekranie startu, szerszy (więcej treści). */}
      <div aria-hidden="true" className="absolute inset-y-0 left-0 hidden w-[60%] bg-paper [clip-path:ellipse(100%_120%_at_0%_50%)] sm:block" />

      <header className="relative z-10 flex h-14 shrink-0 items-center px-2 sm:h-16 sm:px-4">
        <Link
          href="/courses"
          aria-label="Zakończ i wróć do listy kursów"
          className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-ink/45 text-white hover:bg-ink/60 sm:bg-transparent sm:text-slate-600 sm:hover:bg-ink/5"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </Link>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col justify-end sm:w-[60%] sm:justify-center">
        <main
          aria-labelledby="module-end-title"
          className="module-end-card flex max-h-[80%] min-h-0 flex-col gap-3 overflow-y-auto rounded-t-3xl bg-paper px-4 pb-5 pt-[22px] sm:max-h-full sm:gap-[18px] sm:rounded-none sm:bg-transparent sm:py-6 sm:pl-[clamp(24px,7.5vw,96px)] sm:pr-[clamp(24px,5vw,72px)]"
        >
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <p
              data-testid="module-end-stamp"
              className={`-rotate-[4deg] rounded-lg border-[3px] border-danger px-2.5 py-1 text-[13px] font-extrabold uppercase tracking-[0.07em] text-danger sm:px-3 sm:py-1.5 sm:text-[15px] ${
                fresh ? 'motion-safe:animate-badge-pop' : ''
              }`}
            >
              Sprawa zamknięta
            </p>
            <p lang={lang} className="hidden text-sm text-[#6F6F6B] sm:block">
              {moduleTitle}
            </p>
          </div>
          <h1
            id="module-end-title"
            ref={headingRef}
            tabIndex={-1}
            lang={lang}
            className="text-[28px] font-extrabold leading-[1.1] tracking-[-0.03em] outline-none sm:text-[clamp(28px,3.2vw,40px)] sm:leading-[1.08]"
          >
            {headline ?? 'Sprawa zamknięta'}
          </h1>

          <dl className="grid grid-cols-3 gap-2 sm:gap-3">
            {tiles.map(([label, value, accent]) => (
              <div key={label} className="min-w-0 rounded-xl border border-border bg-white px-3 py-2.5 sm:rounded-[14px] sm:px-4 sm:py-3.5">
                <dt className="text-xs text-[#6F6F6B] sm:text-[13px]">{label}</dt>
                <dd
                  data-testid={`module-end-${label.toLowerCase()}`}
                  className={`truncate text-xl font-extrabold tracking-[-0.02em] sm:text-[28px] ${accent ? 'text-accent-ink' : 'text-ink'}`}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {scoreUnavailable && <p className="text-sm font-medium text-danger">Nie udało się pobrać wyniku. Spróbuj odświeżyć stronę.</p>}

          {reward && <LevelCard reward={reward} badges={badges.map((badge) => badge.title)} animate={fresh} />}

          {rules.length > 0 && (
            <section aria-labelledby="module-end-rules" className="flex flex-col gap-1.5 rounded-xl border border-border bg-white px-3.5 py-3 sm:gap-2 sm:rounded-[14px] sm:px-[18px] sm:py-4">
              <h2 id="module-end-rules" className="text-xs font-bold uppercase tracking-[0.06em] text-[#6F6F6B] sm:text-[13px]">
                {rules.length === 3 ? 'Trzy zasady na wynos' : 'Zasady na wynos'}
              </h2>
              <ol lang={lang} className="flex list-none flex-col gap-1.5 text-[15px] leading-snug">
                {rules.map((rule, index) => (
                  <li key={index}>
                    {index + 1}. <SimpleInline text={rule} />
                  </li>
                ))}
              </ol>
            </section>
          )}

          {restartError && <p className="text-sm font-medium text-danger">Nie udało się rozpocząć kursu od nowa. Spróbuj ponownie.</p>}

          {/* Telefon: przyciski przyklejone do dołu karty (makieta - zawsze widoczne), treść nad nimi przewija się w karcie. */}
          <div className="sticky bottom-0 -mx-4 -mb-5 mt-auto flex flex-col gap-2 bg-paper px-4 pb-5 pt-2 shadow-[0_-8px_12px_-10px_rgba(19,19,19,0.25)] sm:shadow-none sm:static sm:mx-0 sm:mb-0 sm:mt-0 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:bg-transparent sm:p-0">
            {/* Następny nieukończony przypisany kurs (D-130); bez niego zamknięta teczka „wkrótce” - aria-disabled, osiągalna Tabem. */}
            {nextCourse ? (
              <Link
                href={`/courses/${encodeURIComponent(nextCourse.courseId)}`}
                data-testid="closing-next-case"
                aria-label={`Następna sprawa: ${nextCourse.title}`}
                className="inline-flex h-[50px] items-center justify-center gap-2 rounded-xl bg-ink px-[22px] text-base font-bold text-white hover:bg-slate-800"
              >
                Następna sprawa
                <ChevronRight aria-hidden="true" className="h-[18px] w-[18px]" />
              </Link>
            ) : (
              <button
                type="button"
                aria-disabled="true"
                className="inline-flex h-[50px] cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-border bg-paper px-[22px] text-base font-bold text-muted"
              >
                <Lock aria-hidden="true" className="h-4 w-4" />
                Następna sprawa · wkrótce
              </button>
            )}
            <Link
              href="/courses"
              className="inline-flex h-[46px] items-center justify-center rounded-xl border border-border bg-white px-[18px] text-[15px] font-semibold text-ink hover:bg-paper sm:h-[50px]"
            >
              Wróć do biblioteki
            </Link>
            <button
              type="button"
              onClick={onRestart}
              disabled={restarting}
              className="min-h-[44px] self-center px-1 text-[15px] font-semibold text-accent-ink underline underline-offset-2 hover:text-ink disabled:opacity-60"
            >
              {restarting ? 'Uruchamianie od nowa…' : 'Zagraj jeszcze raz'}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Poziom z paskiem (D-090, B-153) i nowe osiągnięcie: pasek przesuwa się od stanu sprzed nagrody do stanu po (600 ms; reduced-motion - od
 * razu). Po awansie - nowy poziom od 0 do postępu w nim (`levelProgressNewPercent`); starsze API bez tego pola - w skali starego poziomu.
 */
function LevelCard({ reward, badges, animate }: { reward: CourseCompletionReward; badges: string[]; animate: boolean }) {
  const [grown, setGrown] = useState(!animate);
  useEffect(() => {
    if (!animate) return undefined;
    const timer = window.setTimeout(() => setGrown(true), 300);
    return () => window.clearTimeout(timer);
  }, [animate]);
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  const newPercent = reward.levelProgressNewPercent;
  const inNewLevel = reward.leveledUp && typeof newPercent === 'number';
  const level = inNewLevel ? reward.newLevel : reward.previousLevel;
  const from = inNewLevel ? 0 : reward.levelProgressBeforePercent;
  const to = inNewLevel ? newPercent : reward.levelProgressAfterPercent;
  const percent = clamp(!animate || grown ? to : from);
  const labelId = useId();
  const badgeText = badges.length === 0 ? null : badges.length === 1 ? `Nowe: ${badges[0]}` : `Nowe osiągnięcia: ${badges.join(', ')}`;
  return (
    <div data-testid="module-end-level" className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-xl border border-border bg-white px-3 py-2.5 sm:flex-nowrap sm:rounded-[14px] sm:px-4 sm:py-3">
      <div aria-hidden="true" className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink sm:flex">
        <Trophy className="h-[22px] w-[22px]" />
      </div>
      <div className="flex min-w-0 flex-1 basis-full flex-col gap-1.5 sm:basis-auto">
        <div className="flex justify-between gap-2 text-sm">
          <b id={labelId}>Poziom {level}</b>
          {reward.leveledUp && <span className="font-semibold text-accent-ink">Awans!</span>}
        </div>
        <div
          role="progressbar"
          aria-labelledby={labelId}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clamp(to)}
          className="h-1.5 overflow-hidden rounded-full bg-border"
        >
          <div
            data-testid="level-progress-fill"
            className="h-full w-full rounded-full bg-accent motion-safe:transition-transform motion-safe:duration-[600ms] motion-safe:ease-out-soft"
            style={{ transform: `translateX(${percent - 100}%)` }}
          />
        </div>
      </div>
      {badgeText && (
        <p data-testid="module-end-badge" className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-bold text-[#17774F] sm:whitespace-nowrap">
          {badgeText}
        </p>
      )}
    </div>
  );
}
