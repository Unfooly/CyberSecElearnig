import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { DEFAULT_WEIGHT, BlockType, SWIPE_VERDICTS, idSchema, requiredItemIds } from '@cyberszkolo/content';
import {
  DossierRowLike,
  HotspotLike,
  MAX_DOSSIER_EVIDENCE,
  compileAnswerRegex,
  flattenDossierRows,
  flattenHotspots,
  LiveCallLike,
  replayLiveCall,
  SCORED_BLOCK_TYPES,
  WHEN_BASED_TYPES,
} from '@cyberszkolo/content/dist/node';
import { BlockEntry } from '../progress';
import { recordingAnswer, recordingDetail, scoreRecording } from './recording';

// Ocena odpowiedzi PO STRONIE SERWERA. Klient przesyła wyłącznie swój wybór (indeks, listę id, tekst) - nigdy ocenę ani
// punkty. Bloki pochodzą z zapisanej wersji kursu (klucz odpowiedzi tylko tutaj).

export type Block = Record<string, any> & { id: string; type: string };

export interface SubmitResult {
  entry: BlockEntry;
  // Klucze notatek dopisanych przez ten blok (`<blockId>.<itemId>`).
  notesAdded: string[];
  // Wynik pokazywany po ukończeniu bloku (własny wynik użytkownika: nie ujawnia niczego przed odpowiedzią).
  detail?: Record<string, unknown>;
}

const MAX_TEXT_ANSWER = 500;

const ids = z.array(idSchema).max(50);
// `noted`: hotspoty dodane do notatnika ("Dodaj do notatnika"); podzbiór `visited`, wyłącznie elementy z evidence (evaluateSubmit).
const visitedAnswer = z.object({ visited: ids, noted: ids.optional() }).strict();
const askedAnswer = z.object({ asked: ids }).strict();
const openedAnswer = z.object({ opened: ids }).strict();
// DOSSIER (D-083): otwarte dokumenty i zakreślone wiersze-dowody (bez domyślnego [] - klient zawsze wysyła oba pola). Limit
// `noted` = ta sama stała, którą walidacja modułu ogranicza liczbę wierszy-dowodów w teczce (inaczej blok byłby nie do ukończenia).
const dossierAnswer = z.object({ opened: ids, noted: z.array(idSchema).max(MAX_DOSSIER_EVIDENCE) }).strict();
const selectedAnswer = z.object({ selected: ids }).strict();
const orderAnswer = z.object({ order: ids }).strict();
const seenAnswer = z.object({ seen: z.number().int().min(0).max(20) }).strict();
// INTERROGATION (D-118): zadane pytania, fragmenty i wiersze konsoli dodane do notatnika, otwarte dokumenty konsoli. Podważenia idą
// osobno (/challenge) - serwer zna je z wpisu bloku.
const interrogationAnswer = z.object({ asked: ids, noted: z.array(idSchema).max(MAX_DOSSIER_EVIDENCE), opened: ids.optional() }).strict();
// OSINT_SPOT (D-120): zaznaczone obszary i wysłuchane do końca nagrania (id ukrytych zakończeń - bramka UX jak easter egg).
const osintAnswer = z.object({ marked: z.array(idSchema).max(20), heard: z.array(idSchema).max(20).optional() }).strict();
// LIVE_CALL (D-122): ścieżka odpowiedzi (id odpowiedzi albo "silence" po upływie limitu) i czy podejście było z limitem czasu. Węzłów jest
// najwyżej 20 i graf nie ma cykli, więc ścieżka ma najwyżej 20 kroków.
const liveCallAnswer = z.object({ path: z.array(idSchema).min(1).max(20), timed: z.boolean() }).strict();

function parseAnswer<T>(schema: z.ZodType<T>, answer: unknown): T {
  const parsed = schema.safeParse(answer);
  if (!parsed.success) throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
  return parsed.data;
}

export function weightOf(block: Block): number {
  if (typeof block.weight === 'number') return block.weight;
  // Przesłuchanie bez sprzeczności nie ma wyniku (D-118) - domyślna waga typu dotyczy tylko bloku ze sprzecznościami.
  if (block.type === 'INTERROGATION' && interrogationLines(block).every((line) => !line.contradiction)) return 0;
  return Object.prototype.hasOwnProperty.call(DEFAULT_WEIGHT, block.type) ? DEFAULT_WEIGHT[block.type as BlockType] : 0;
}

function unique(list: string[]): boolean {
  return new Set(list).size === list.length;
}

function baseEntry(block: Block, now: Date, extra: Partial<BlockEntry> = {}): BlockEntry {
  return { type: block.type, done: true, answeredAt: now.toISOString(), weight: weightOf(block), ...extra };
}

/** Bramka wymaganych elementów w blokach eksploracyjnych (hotspoty, dialog, zakładki). To bramka UX, nie dowód kliknięcia. */
function requireCoverage(label: string, given: string[], allIds: string[], required: string[] | undefined) {
  if (!unique(given) || given.some((id) => !allIds.includes(id))) {
    throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
  }
  const need = required ?? allIds;
  if (need.some((id) => !given.includes(id))) {
    throw new BadRequestException(`Nie ukończono wymaganych elementów (${label})`);
  }
}

const noteKey = (blockId: string, itemId: string) => `${blockId}.${itemId}`;

/** Wyróżnienia easter egga (D-100): id `media.badge` odwiedzonych hotspotów z okienkami (media.kind "popups"), bez powtórzeń. */
function easterEggIds(hotspots: HotspotLike[], visited: string[]): string[] {
  const ids = hotspots
    .filter((h) => visited.includes(h.id))
    .map((h) => h.media as { kind?: string; badge?: { id?: unknown } } | undefined)
    .filter((media) => media?.kind === 'popups' && typeof media.badge?.id === 'string')
    .map((media) => media!.badge!.id as string);
  return [...new Set(ids)];
}

/** Nieprzejrzyste id elementu widziane przez klienta (client-view.ts, shuffleContext.opaqueId). */
export type OpaqueId = (blockId: string, itemId: string) => string;

/**
 * Tłumaczy id z odpowiedzi klienta (nieprzejrzyste) na id z treści. Id spoza tego przypisania (np. z cudzego assignmentu) nie
 * mają odpowiednika, więc odpowiedź jest odrzucana zwykłym, bezpiecznym komunikatem (bez treści bloku).
 */
function toRealIds(block: Block, opaque: OpaqueId, items: { id: string }[], given: string[]): string[] {
  const byOpaque = new Map(items.map((item) => [opaque(block.id, item.id), item.id]));
  const real = given.map((id) => byOpaque.get(id));
  if (real.some((id) => id === undefined)) throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
  return real as string[];
}

export function evaluateSubmit(
  block: Block,
  answer: unknown,
  existing: BlockEntry | undefined,
  now: Date,
  opaque: OpaqueId,
  // Ustawienia konta wpływające na ocenę: „Bez limitów czasu” (D-124) - rozmowa na żywo bez krawędzi ciszy. `simpleMode` - wersja kursu
  // w trybie prostym (D-132): wybór oceniany z pierwszej próby /check.
  account: { noTimeLimits?: boolean; simpleMode?: boolean } = {},
): SubmitResult {
  switch (block.type) {
    case 'SWIPE_SORT': {
      // D-132: wszystkie karty ocenione przez /check; wynik = trafione werdykty / karty. Bez `correct` (blok nie jest „dobrze/źle”).
      if (answer !== undefined) parseAnswer(swipeSubmitAnswer, answer);
      const checks = existing?.checks ?? [];
      const cards = swipeCards(block);
      if (cards.some((card) => !checks.some((check) => check.item === card.id))) {
        throw new BadRequestException('Nie oceniono wszystkich wiadomości');
      }
      const hits = cards.filter((card) => checks.find((check) => check.item === card.id)?.correct).length;
      return { entry: baseEntry(block, now, { points: cards.length > 0 ? hits / cards.length : 0, checks }), notesAdded: [] };
    }
    case 'QUIZ':
      if (account.simpleMode) {
        // Tryb prosty (D-132): próby do skutku przez /check - „Dalej” dopiero po trafieniu; wynik z PIERWSZEJ próby. `answer` od klienta
        // celowo pominięty: zapisujemy indeks trafienia z prób na serwerze (klient nie wybiera, co się liczy).
        const checks = existing?.checks ?? [];
        const hit = checks.find((check) => check.correct);
        if (!hit) throw new BadRequestException('Najpierw wybierz poprawną odpowiedź');
        const first = checks[0].correct;
        return {
          entry: baseEntry(block, now, { answer: Number(hit.item), correct: first, points: first ? 1 : 0, checks }),
          notesAdded: [],
        };
      }
    // falls through
    case 'BRANCHING_SCENARIO': {
      const options: Record<string, any>[] = Array.isArray(block.options) ? block.options : [];
      if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer >= options.length) {
        throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
      }
      const option = options[answer];
      const correct = option.correct === true || option.outcome === 'correct';
      return {
        entry: baseEntry(block, now, { answer, correct, points: correct ? 1 : 0 }),
        notesAdded: [],
      };
    }

    case 'SCENE_HOTSPOTS': {
      const { visited, noted = [] } = parseAnswer(visitedAnswer, answer);
      // Spłaszczone: zewnętrzne hotspoty + wewnętrzne z media.kind:'scene' (B-086/D-071) - ta sama funkcja co walidacja
      // modułu (semantics.ts), więc "ten sam zbiór id" jest dokładnie jedną definicją, nie dwiema, które mogłyby się rozjechać.
      const hotspots = flattenHotspots(block.hotspots as HotspotLike[]);
      const all = hotspots.map((h) => h.id);
      // Drzwi (action:'next', B-086/D-071) WYKLUCZONE z puli required: nigdy nie trafiają do `visited` same z siebie
      // (klik od razu kończy blok) - inaczej scena z SAMYMI drzwiami nigdy nie mogłaby się ukończyć (semantics.ts ma
      // tę samą wykluczenie przy walidacji modułu).
      const doorIds = new Set((block.hotspots as { id: string; action?: string }[]).filter((h) => h.action === 'next').map((h) => h.id));
      // Okienka easter egga (D-100) też poza pulą required - także w domyślnym „wszystkie wymagane” (bez flag required).
      const optional = (h: HotspotLike) => doorIds.has(h.id) || h.media?.kind === 'popups';
      requireCoverage('hotspoty', visited, all, requiredItemIds(hotspots.filter((h) => !optional(h)), block.requiredHotspots));
      // Do notatnika trafia tylko odwiedzony hotspot z evidence (i notatką); reszta to zwykły, bezpieczny 400 bez treści bloku.
      const evidenceIds = hotspots.filter((h) => h.evidence === true && h.note).map((h) => h.id);
      if (!unique(noted) || noted.some((id) => !visited.includes(id) || !evidenceIds.includes(id))) {
        throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
      }
      // Easter egg (D-100): odwiedzony hotspot z okienkami i wyróżnieniem zapisuje TYLKO flagę wyróżnienia (id z treści) - bez
      // punktów, dowodów i XP. Klient dopisuje hotspot do `visited` dopiero po zamknięciu wszystkich okienek (bramka UX, jak reszta).
      const easterEggs = easterEggIds(hotspots, visited);
      return {
        entry: baseEntry(block, now, { ...weightPoints(block), ...(easterEggs.length > 0 ? { easterEggs } : {}) }),
        notesAdded: noted.map((id) => noteKey(block.id, id)),
      };
    }

    case 'DIALOGUE': {
      const { asked } = parseAnswer(askedAnswer, answer);
      const questions = block.questions as { id: string; required?: boolean; note?: unknown }[];
      requireCoverage('pytania', asked, questions.map((q) => q.id), requiredItemIds(questions, block.requiredQuestions));
      const notesAdded = questions.filter((q) => q.note && asked.includes(q.id)).map((q) => noteKey(block.id, q.id));
      return { entry: baseEntry(block, now, weightPoints(block)), notesAdded };
    }

    case 'DOSSIER': {
      // Teczka (D-083): wszystkie dokumenty otwarte (jak zakładki TABS), `noted` = zakreślone wiersze-dowody - ta sama ścieżka
      // notatek co hotspoty (klucz `<blockId>.<rowId>`). Zwykła linijka nigdy nie trafia do `noted` (400 bez treści bloku).
      const { opened, noted } = parseAnswer(dossierAnswer, answer);
      const documents = block.documents as { id: string; rows: DossierRowLike[] }[];
      requireCoverage('dokumenty', opened, documents.map((d) => d.id), undefined);
      const rows = flattenDossierRows(documents);
      const evidenceIds = rows.filter((r) => r.evidence === true && r.note).map((r) => r.id);
      if (!unique(noted) || noted.some((id) => !evidenceIds.includes(id))) {
        throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
      }
      // Wymagane wiersze (required: true, tylko dowody - walidacja treści) muszą być zakreślone - ta sama reguła co klient.
      const required = rows.filter((r) => r.required === true).map((r) => r.id);
      if (required.some((id) => !noted.includes(id))) {
        throw new BadRequestException('Nie ukończono wymaganych elementów (dowody w teczce)');
      }
      return { entry: baseEntry(block, now, weightPoints(block)), notesAdded: noted.map((id) => noteKey(block.id, id)) };
    }

    case 'TABS': {
      const { opened } = parseAnswer(openedAnswer, answer);
      const all = (block.tabs as { id: string }[]).map((t) => t.id);
      requireCoverage('zakładki', opened, all, block.requiredTabs);
      return { entry: baseEntry(block, now, weightPoints(block)), notesAdded: [] };
    }

    case 'EMAIL_ANALYSIS': {
      const { selected: selectedOpaque } = parseAnswer(selectedAnswer, answer);
      const criteria = block.criteria as { id: string; correct: boolean; explanation?: string; note?: unknown }[];
      const selected = toRealIds(block, opaque, criteria, selectedOpaque);
      if (!unique(selected)) {
        throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
      }
      const correctIds = criteria.filter((c) => c.correct).map((c) => c.id);
      const hits = selected.filter((id) => correctIds.includes(id)).length;
      const wrong = selected.length - hits;
      const points = emailPoints(block.scoring, correctIds.length, hits, wrong);
      const notesAdded = criteria
        .filter((c) => c.correct && c.note && selected.includes(c.id))
        .map((c) => noteKey(block.id, c.id));
      return {
        // `selected` (id z treści) zostaje w wpisie: podgląd ukończonego bloku ("Wstecz") pokazuje wybór gracza (clientProgress).
        entry: baseEntry(block, now, { correct: points === 1, points, selected }),
        notesAdded,
        detail: emailDetail(block, selected, opaque),
      };
    }

    case 'ORDERING': {
      const { order: orderOpaque } = parseAnswer(orderAnswer, answer);
      const items = block.items as { id: string }[];
      const correctOrder = items.map((i) => i.id);
      const order = toRealIds(block, opaque, items, orderOpaque);
      if (order.length !== correctOrder.length || !unique(order)) {
        throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
      }
      const inPlace = order.filter((id, index) => id === correctOrder[index]).length;
      const points = block.scoring === 'exact' ? (inPlace === correctOrder.length ? 1 : 0) : inPlace / correctOrder.length;
      return {
        entry: baseEntry(block, now, { correct: points === 1, points, order }),
        notesAdded: [],
        detail: orderingDetail(block, opaque),
      };
    }

    case 'CALL_RECORDING': {
      // Odsłuch nagrania (D-115): trafione flagi, fałszywe tapnięcia, punkty - recording.ts. Dowód nagrania trafia do notatnika, gdy
      // flaga na jego segmencie została trafiona.
      const { taps } = parseAnswer(recordingAnswer, answer);
      const score = scoreRecording(block as Block & Parameters<typeof scoreRecording>[0], taps);
      const evidence = (Array.isArray(block.evidence) ? block.evidence : []) as { id: string; segmentId: string }[];
      return {
        entry: baseEntry(block, now, { correct: score.points === 1, points: score.points, flagsHit: score.flagsHit, falseTaps: score.falseTaps }),
        notesAdded: evidence.filter((item) => score.flagsHit.includes(item.segmentId)).map((item) => noteKey(block.id, item.id)),
        detail: recordingDetail(block as Block & Parameters<typeof recordingDetail>[0], score),
      };
    }

    case 'INTERROGATION': {
      // Przesłuchanie (D-118): wszystkie wymagane pytania zadane; `noted` = fragmenty zadanych pytań i wiersze-dowody otwartej konsoli
      // (klucz `<blockId>.<id>`, jak hotspot). Konsola (documents): po zadaniu pytania, które ją otwiera, wszystkie dokumenty otwarte i
      // wymagane wiersze zakreślone. Wynik z podważeń zapisanych przez /challenge (niżej).
      const { asked, noted, opened = [] } = parseAnswer(interrogationAnswer, answer);
      const questions = block.questions as InterrogationQuestion[];
      requireCoverage('pytania', asked, questions.map((q) => q.id), requiredItemIds(questions, undefined));
      const documents = (Array.isArray(block.documents) ? block.documents : []) as { id: string; rows: DossierRowLike[] }[];
      const consoleOpened = questions.some((q) => q.opensDocuments === true && asked.includes(q.id));
      if (consoleOpened) requireCoverage('dokumenty', opened, documents.map((d) => d.id), undefined);
      else if (opened.length > 0) throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
      const askedFragments = questions.filter((q) => asked.includes(q.id)).flatMap((q) => q.lines.filter((line) => line.fragment?.note).map((line) => line.id));
      const rows = consoleOpened ? flattenDossierRows(documents) : [];
      const evidenceRows = rows.filter((r) => r.evidence === true && r.note).map((r) => r.id);
      if (!unique(noted) || noted.some((id) => !askedFragments.includes(id) && !evidenceRows.includes(id))) {
        throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
      }
      if (rows.some((r) => r.required === true && !noted.includes(r.id))) {
        throw new BadRequestException('Nie ukończono wymaganych elementów (dowody w konsoli)');
      }
      // Podważenia wyłącznie przy kwestiach zadanych pytań - bramka UX (jak `asked` w DIALOGUE; `asked` deklaruje klient), nie zabezpieczenie:
      // kwestie są publiczne, a punkty zależą tylko od dowodu.
      const challenges = existing?.challenges ?? [];
      const askedLines = questions.filter((q) => asked.includes(q.id)).flatMap((q) => q.lines.map((line) => line.id));
      if (challenges.some((c) => !askedLines.includes(c.lineId))) throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
      // Wynik = trafienia / (sprzeczności + pudła) - pudło (prawdziwa kwestia albo zły dowód) kosztuje, więc „Podważ” przy każdej kwestii
      // nie daje pełnego wyniku bez rozpoznania kłamstwa (security review 1c).
      const contradictions = interrogationLines(block).filter((line) => line.contradiction).length;
      const hits = challenges.filter((c) => c.correct).length;
      const misses = challenges.length - hits;
      const scored =
        contradictions > 0 && weightOf(block) > 0 ? { points: hits / (contradictions + misses), correct: hits === contradictions && misses === 0 } : {};
      return {
        entry: baseEntry(block, now, { ...scored, ...(challenges.length > 0 ? { challenges } : {}) }),
        notesAdded: noted.map((id) => noteKey(block.id, id)),
        detail: interrogationDetail(block),
      };
    }

    case 'OSINT_SPOT': {
      // OSINT (D-120): trafione użyte / wszystkie użyte − kara × zaznaczone pułapki (min. 0). Dowody - notatki zaznaczonych użytych obszarów
      // (po ocenie, bo zdradzają użycie). Ukryte zakończenie nagrania: tylko flaga (wyróżnienie), bez punktów.
      const { marked, heard = [] } = parseAnswer(osintAnswer, answer);
      const spots = osintSpots(block);
      const spotIds = spots.map((spot) => spot.id);
      const endings = spots.flatMap((spot) => (spot.media?.secretEnding ? [spot.media.secretEnding.id] : []));
      if (!unique(marked) || marked.some((id) => !spotIds.includes(id)) || !unique(heard) || heard.some((id) => !endings.includes(id))) {
        throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
      }
      const used = spots.filter((spot) => spot.used).map((spot) => spot.id);
      const hits = marked.filter((id) => used.includes(id)).length;
      const traps = marked.length - hits;
      const penalty = typeof block.falseSpotPenalty === 'number' ? block.falseSpotPenalty : DEFAULT_FALSE_SPOT_PENALTY;
      const points = used.length === 0 ? 0 : Math.max(0, hits / used.length - penalty * traps);
      return {
        // `correct` - wszystkie użyte i żadnej pułapki (przy karze 0 „zaznacz wszystko” też daje 1 punkt, ale nie jest poprawne).
        entry: baseEntry(block, now, { correct: hits === used.length && traps === 0, points, marked, ...(heard.length > 0 ? { secretEndings: heard } : {}) }),
        notesAdded: spots.filter((spot) => spot.used && spot.note && marked.includes(spot.id)).map((spot) => noteKey(block.id, spot.id)),
        detail: osintDetail(block, marked),
      };
    }

    case 'LIVE_CALL': {
      // Rozmowa na żywo (D-122): serwer przechodzi drzewo po ścieżce gracza (ta sama funkcja co walidacja treści) i ocenia zakończenie.
      // Cisza (krawędź `silence`) tylko w podejściu z limitem czasu - bez limitu nie ma czego przemilczeć. Konto z „Bez limitów czasu”
      // (D-124) nie ma limitu niezależnie od `timed` od klienta; zapisany tryb to tryb faktyczny.
      const { path, timed: requested } = parseAnswer(liveCallAnswer, answer);
      const timed = requested && account.noTimeLimits !== true;
      const walked = replayLiveCall(block as unknown as LiveCallLike, path, { allowSilence: timed });
      if (!walked) throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
      const outcome = liveCallWalkOutcome(block, walked);
      return {
        entry: baseEntry(block, now, { correct: outcome === 'good', points: LIVE_CALL_POINTS[outcome], path, timed }),
        notesAdded: [],
        detail: liveCallDetail(block, path),
      };
    }

    case 'ANNOTATED_REPLAY': {
      // Omówienie (D-115): ukończone po przejściu wszystkich znaczników (bramka UX, jak zakładki).
      const { seen } = parseAnswer(seenAnswer, answer);
      const markers = Array.isArray(block.markers) ? block.markers.length : 0;
      if (seen !== markers) throw new BadRequestException('Nie ukończono wymaganych elementów (znaczniki omówienia)');
      return { entry: baseEntry(block, now, weightPoints(block)), notesAdded: [] };
    }

    case 'TEXT_INPUT_GUIDED': {
      // "Dalej" po zadaniu: sama ocena zapada w /attempt. Bez rozstrzygnięcia (poprawna próba albo wyczerpane próby) nie da się przejść.
      if (!existing || !existing.done) {
        throw new BadRequestException('Najpierw rozwiąż zadanie (odpowiedz w polu tekstowym)');
      }
      return { entry: existing, notesAdded: [] };
    }

    // VIDEO, DRAG_AND_DROP, EMBEDDED_HTML, NOTEPAD, SUMMARY i typy nieznane (np. z wersji sprzed silnika): samo oznaczenie
    // wykonania, odpowiedź klienta jest ignorowana, nic nie jest oceniane po jego stronie.
    default:
      return { entry: baseEntry(block, now), notesAdded: [] };
  }
}

/**
 * Rozstrzygnięcie kryteriów maila po odpowiedzi (id nieprzejrzyste, jak w /start). Ta sama postać idzie w odpowiedzi /progress i, dla
 * bloku UKOŃCZONEGO, w widoku postępu (clientProgress): po ukończeniu klucz nie jest już tajny (pokazano go w wyniku).
 */
export function emailDetail(block: Block, selected: string[], opaque: OpaqueId) {
  const criteria = (Array.isArray(block.criteria) ? block.criteria : []) as { id: string; correct: boolean; explanation?: string }[];
  return {
    criteria: criteria.map((c) => ({
      id: opaque(block.id, c.id),
      correct: c.correct,
      selected: selected.includes(c.id),
      ...(c.explanation ? { explanation: c.explanation } : {}),
    })),
  };
}

/** Poprawna kolejność (id nieprzejrzyste) i wyjaśnienie: jak wyżej, tylko po ukończeniu bloku. */
export function orderingDetail(block: Block, opaque: OpaqueId) {
  const items = (Array.isArray(block.items) ? block.items : []) as { id: string }[];
  return {
    correctOrder: items.map((i) => opaque(block.id, i.id)),
    ...(block.explanation ? { explanation: block.explanation } : {}),
  };
}

// --- LIVE_CALL (D-122) --------------------------------------------------------------------------------------------------

type LiveCallOutcome = 'good' | 'partial' | 'bad';
const LIVE_CALL_POINTS: Record<LiveCallOutcome, number> = { good: 1, partial: 0.5, bad: 0 };

function liveCallOutcome(block: Block, endingId: string): LiveCallOutcome {
  const endings = (block as unknown as LiveCallLike).endings;
  const ending = Array.isArray(endings) ? endings.find((candidate) => candidate?.id === endingId) : undefined;
  return ending?.outcome === 'good' || ending?.outcome === 'partial' ? ending.outcome : 'bad';
}

/** Odpowiedzi ze ścieżki, które oddały informację (`infoChoices` - sekret treści). */
function liveCallGaveInfo(block: Block, choices: readonly string[]): string[] {
  const infoChoices = (block as unknown as LiveCallLike).infoChoices;
  const info = Array.isArray(infoChoices) ? infoChoices : [];
  return choices.filter((id) => info.includes(id));
}

/**
 * Ocena przebytej rozmowy: zakończenie z treści; rozłączenie się (`hangup`, D-129) po oddaniu informacji jest złe niezależnie od zakończenia
 * „rozłączenia” - informacja już wyszła, a tekst zakończenia (publiczny) nie może zależeć od sekretnego `infoChoices`.
 */
function liveCallWalkOutcome(block: Block, walked: { ending: string; choices: string[]; hungUp?: boolean }): LiveCallOutcome {
  if (walked.hungUp && liveCallGaveInfo(block, walked.choices).length > 0) return 'bad';
  return liveCallOutcome(block, walked.ending);
}

/**
 * Rozstrzygnięcie rozmowy po ocenie (odpowiedź zapisu i podgląd ukończonego bloku): zakończenie, jego ocena i odpowiedzi ze ścieżki, które
 * oddały informację (`infoChoices` - sekret treści, tu tylko te wybrane przez gracza). Ścieżka pochodzi z zapisanego wpisu (przeszła ocenę);
 * uszkodzona treść albo wpis - bez rozstrzygnięcia (undefined), nie 500 na widoku kursu.
 */
export function liveCallDetail(block: Block, path: readonly string[]) {
  const walked = replayLiveCall(block as unknown as LiveCallLike, path, { allowSilence: true });
  if (!walked) return undefined;
  return { ending: walked.ending, outcome: liveCallWalkOutcome(block, walked), gaveInfo: liveCallGaveInfo(block, walked.choices) };
}

// --- OSINT_SPOT (D-120) -------------------------------------------------------------------------------------------------

/** Kara za zaznaczoną pułapkę, gdy treść jej nie ustawia (specyfikacja modułu 2, rozdz. 4.3). */
export const DEFAULT_FALSE_SPOT_PENALTY = 0.25;

interface OsintSpot {
  id: string;
  used: boolean;
  note?: unknown;
  trapText?: string;
  media?: { secretEnding?: { id: string; label: string; note?: string } };
}

function osintSpots(block: Block): OsintSpot[] {
  return Array.isArray(block.spots) ? (block.spots as OsintSpot[]) : [];
}

/**
 * Rozstrzygnięcie OSINT po ocenie (jak klucz maila - w odpowiedzi zapisu i w podglądzie ukończonego bloku): który obszar był użyty, czy
 * gracz go zaznaczył i wyjaśnienie każdej pułapki. Id obszarów są publiczne.
 */
export function osintDetail(block: Block, marked: string[]) {
  return {
    spots: osintSpots(block).map((spot) => ({
      id: spot.id,
      used: spot.used,
      marked: marked.includes(spot.id),
      ...(spot.trapText !== undefined ? { trapText: spot.trapText } : {}),
    })),
  };
}

/** Ukryte zakończenia nagrań (wyróżnienia w notatniku) wysłuchane w bloku OSINT - etykieta i zdanie z treści dla id z postępu. */
export function osintSecretEndings(block: Block, heard: readonly string[]) {
  return osintSpots(block)
    .flatMap((spot) => (spot.media?.secretEnding ? [spot.media.secretEnding] : []))
    .filter((ending) => heard.includes(ending.id));
}

// --- INTERROGATION (D-118) ----------------------------------------------------------------------------------------------

interface InterrogationLine {
  id: string;
  fragment?: { note?: unknown };
  contradiction?: { refutedBy: string; challengeLine: { text: string } };
}
interface InterrogationQuestion {
  id: string;
  required?: boolean;
  opensDocuments?: boolean;
  lines: InterrogationLine[];
}

function interrogationLines(block: Block): InterrogationLine[] {
  return (Array.isArray(block.questions) ? (block.questions as InterrogationQuestion[]) : []).flatMap((q) => (Array.isArray(q.lines) ? q.lines : []));
}

export interface ChallengeResponse {
  blockId: string;
  lineId: string;
  correct: boolean;
  /** Kwestia po podważeniu (sekret treści) - wyłącznie po trafieniu. */
  line?: { text: string };
}

/**
 * Podważenie kwestii przesłuchania (D-118): `evidenceKey` to klucz notatki z notatnika gracza (serwer tłumaczy go z nieprzejrzystego
 * odnośnika i sprawdza, że notatka jest w postępie). Jedna próba na kwestię - także na kwestię bez sprzeczności (klient nie wie, która
 * kłamie, więc „pudło” na prawdziwej kwestii wygląda tak samo jak zły dowód). Trafienie odsłania `challengeLine` i dopisuje notatkę
 * sprzeczności. Blok nie jest tu ukończony (done: false) - zapis bloku („Dalej”) przenosi podważenia do wpisu z wynikiem.
 */
export function evaluateChallenge(
  block: Block,
  lineId: string,
  evidenceKey: string,
  existing: BlockEntry | undefined,
  now: Date,
): { entry: BlockEntry; response: ChallengeResponse; notesAdded: string[] } {
  const line = interrogationLines(block).find((candidate) => candidate.id === lineId);
  if (!line) throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
  const challenges = existing?.challenges ?? [];
  if (challenges.some((c) => c.lineId === lineId)) throw new BadRequestException('Ta kwestia była już podważona');
  const correct = line.contradiction !== undefined && line.contradiction.refutedBy === evidenceKey;
  const entry: BlockEntry = {
    type: block.type,
    done: false,
    answeredAt: now.toISOString(),
    weight: weightOf(block),
    challenges: [...challenges, { lineId, correct }],
  };
  return {
    entry,
    response: { blockId: block.id, lineId, correct, ...(correct && line.contradiction ? { line: { text: line.contradiction.challengeLine.text } } : {}) },
    notesAdded: correct ? [noteKey(block.id, lineId)] : [],
  };
}

// --- Tryb prosty i segregowanie wiadomości (D-132): ocena każdego kliknięcia od razu (/check) ------------------------------------------

/** Podpowiedź (sekret `hint`) przychodzi w odpowiedzi /check od tylu błędnych kliknięć w bloku. */
export const SIMPLE_HINT_AFTER_ERRORS = 2;

const quizCheckAnswer = z.object({ option: z.number().int().min(0).max(7) }).strict();
// Karta po id nieprzejrzystym (jak elementy ORDERING) i werdykt gracza.
const swipeCheckAnswer = z.object({ card: idSchema, verdict: z.enum(SWIPE_VERDICTS) }).strict();
// Zapis bloku SWIPE_SORT nie niesie odpowiedzi (werdykty są już w postępie z /check) - pusty obiekt albo brak pola.
const swipeSubmitAnswer = z.object({}).strict();

type SwipeCard = { id: string; correct: string; feedback: string };
const swipeCards = (block: Block): SwipeCard[] => (Array.isArray(block.cards) ? block.cards : []);

export interface CheckResponse {
  blockId: string;
  /** Ocena tego kliknięcia (`good`/`bad`) - nigdy pole `correct` z treści. */
  result: 'good' | 'bad';
  /** Jedno zdanie po kliknięciu (sekret treści dla tej odpowiedzi/karty - ujawniony dopiero po wyborze). */
  feedback: string;
  /** Podpowiedź bloku po SIMPLE_HINT_AFTER_ERRORS błędach. */
  hint?: string;
  /** Blok gotowy do zapisu („Dalej”): wybór trafiony albo wszystkie karty ocenione. */
  done: boolean;
}

const errorCount = (checks: readonly { correct: boolean }[]) => checks.filter((check) => !check.correct).length;
const simpleHint = (block: Block, checks: readonly { correct: boolean }[]) =>
  errorCount(checks) >= SIMPLE_HINT_AFTER_ERRORS && typeof block.hint === 'string' ? block.hint : undefined;

/**
 * Ocena jednego kliknięcia (/check, D-132): QUIZ w trybie prostym (wybór - próby do skutku, wynik z PIERWSZEJ) i SWIPE_SORT (każda karta
 * raz). Zapisuje próbę w postępie (`checks`, id z treści) zanim blok jest ukończony; zapis bloku („Dalej”) liczy wynik z tych prób.
 */
export function evaluateCheck(
  block: Block,
  answer: unknown,
  existing: BlockEntry | undefined,
  now: Date,
  opaque: OpaqueId,
  simpleMode: boolean,
): { entry: BlockEntry; response: CheckResponse } {
  const checks = existing?.checks ?? [];
  let item: string;
  let correct: boolean;
  let feedback: string;
  let done: boolean;
  if (block.type === 'QUIZ' && simpleMode) {
    const { option } = parseAnswer(quizCheckAnswer, answer);
    const options: Record<string, any>[] = Array.isArray(block.options) ? block.options : [];
    if (option >= options.length) throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
    if (checks.some((check) => check.correct)) throw new BadRequestException('Ten wybór jest już rozstrzygnięty');
    item = String(option);
    if (checks.some((check) => check.item === item)) throw new BadRequestException('Ta odpowiedź była już sprawdzona');
    correct = options[option].correct === true;
    feedback = typeof options[option].feedback === 'string' ? options[option].feedback : '';
    done = correct;
  } else if (block.type === 'SWIPE_SORT') {
    const { card, verdict } = parseAnswer(swipeCheckAnswer, answer);
    const cards = swipeCards(block);
    const [realId] = toRealIds(block, opaque, cards, [card]);
    if (checks.some((check) => check.item === realId)) throw new BadRequestException('Ta karta jest już oceniona');
    const target = cards.find((candidate) => candidate.id === realId)!;
    item = realId;
    correct = target.correct === verdict;
    feedback = target.feedback;
    done = checks.length + 1 >= cards.length;
  } else {
    throw new BadRequestException('Ten blok nie przyjmuje sprawdzania odpowiedzi');
  }
  const next = [...checks, { item, correct }];
  const hint = simpleHint(block, next);
  return {
    entry: { type: block.type, done: false, answeredAt: now.toISOString(), weight: weightOf(block), checks: next },
    response: { blockId: block.id, result: correct ? 'good' : 'bad', feedback, ...(hint ? { hint } : {}), done },
  };
}

/** Widok prób /check dla klienta (odświeżenie strony w trakcie bloku, D-132): karty po id nieprzejrzystym, wybór po indeksie. */
export function checksView(block: Block, entry: BlockEntry, opaque: OpaqueId) {
  const checks = entry.checks ?? [];
  const feedbackOf = (item: string): string => {
    if (block.type === 'SWIPE_SORT') return swipeCards(block).find((card) => card.id === item)?.feedback ?? '';
    const option = Array.isArray(block.options) ? block.options[Number(item)] : undefined;
    return typeof option?.feedback === 'string' ? option.feedback : '';
  };
  const view = checks.map((check) => ({
    item: block.type === 'SWIPE_SORT' ? opaque(block.id, check.item) : Number(check.item),
    result: check.correct ? ('good' as const) : ('bad' as const),
    feedback: feedbackOf(check.item),
  }));
  const hint = simpleHint(block, checks);
  return { checks: view, ...(hint ? { hint } : {}) };
}

/**
 * Stan częściowy sceny (SCENE_HOTSPOTS, D-128): gracz wyszedł z bloku w połowie - obejrzane przedmioty i zabrane dowody zostają w
 * postępie i wracają po ponownym wejściu. Te same reguły co przy zapisie bloku (evaluate), bez bramki wymaganych elementów:
 *  - `visited` i `noted` to id przedmiotów TEJ sceny (spłaszczone z zagnieżdżonymi), bez powtórzeń; drzwi (action: next) nie są
 *    przedmiotem do obejrzenia;
 *  - `noted` tylko dla obejrzanego przedmiotu-dowodu z notatką;
 *  - stan tylko rośnie: wynik to suma z poprzednim zapisem (spóźnione albo powtórzone żądanie niczego nie cofa).
 * Blok nie jest tu ukończony (done: false), nie ma punktów ani wyróżnień easter egga - te nadaje dopiero zapis bloku („Dalej”).
 * To bramka UX jak przy zapisie bloku, nie dowód kliknięcia: klient zgłasza, co obejrzał.
 */
export function evaluateExploration(
  block: Block,
  answer: { visited: string[]; noted: string[] },
  existing: BlockEntry | undefined,
  now: Date,
): { entry: BlockEntry; notesAdded: string[] } {
  if (block.type !== 'SCENE_HOTSPOTS') throw new BadRequestException('Ten blok nie zapisuje stanu częściowego');
  // Ukończonego wpisu (punkty, wyróżnienia) stan częściowy nigdy nie zastępuje - także przy niespójnym postępie (jak evaluateAttempt).
  if (existing?.done) throw new BadRequestException('Ten blok jest już ukończony');
  const hotspots = flattenHotspots(block.hotspots as HotspotLike[]);
  const doorIds = new Set((block.hotspots as { id: string; action?: string }[]).filter((h) => h.action === 'next').map((h) => h.id));
  const viewable = hotspots.filter((h) => !doorIds.has(h.id)).map((h) => h.id);
  const evidenceIds = hotspots.filter((h) => h.evidence === true && h.note).map((h) => h.id);
  const { visited, noted } = answer;
  const invalid =
    !unique(visited) ||
    !unique(noted) ||
    visited.some((id) => !viewable.includes(id)) ||
    noted.some((id) => !visited.includes(id) || !evidenceIds.includes(id));
  if (invalid) throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
  // Poprzedni stan czytamy obronnie (postęp zapisuje serwer, ale wpis mógł powstać przed tą funkcją albo z innej wersji treści).
  const previous = (list: unknown) => (Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []);
  const merge = (before: string[], next: string[], allowed: string[]) => allowed.filter((id) => before.includes(id) || next.includes(id));
  const mergedVisited = merge(previous(existing?.visited), visited, viewable);
  const mergedNoted = merge(previous(existing?.noted), noted, evidenceIds).filter((id) => mergedVisited.includes(id));
  return {
    entry: { type: block.type, done: false, answeredAt: now.toISOString(), weight: weightOf(block), visited: mergedVisited, noted: mergedNoted },
    notesAdded: mergedNoted.map((id) => noteKey(block.id, id)),
  };
}

/**
 * Rozstrzygnięcie przesłuchania po ukończeniu bloku: które kwestie kłamały i ich przyznanie (sekret treści, ujawniany jak klucz maila -
 * dopiero w odpowiedzi zapisu bloku i w podglądzie ukończonego bloku). Id kwestii są publiczne.
 */
export function interrogationDetail(block: Block) {
  return {
    contradictions: interrogationLines(block)
      .filter((line) => line.contradiction)
      .map((line) => ({ lineId: line.id, line: { text: line.contradiction!.challengeLine.text } })),
  };
}

/** Wynik podważeń do widoku postępu (odświeżenie strony w trakcie, podgląd wstecz): kwestia po podważeniu tylko przy trafieniu. */
export function challengesView(block: Block, challenges: { lineId: string; correct: boolean }[]) {
  const lines = interrogationLines(block);
  return challenges.map(({ lineId, correct }) => {
    const text = correct ? lines.find((line) => line.id === lineId)?.contradiction?.challengeLine.text : undefined;
    return { lineId, correct, ...(text !== undefined ? { line: { text } } : {}) };
  });
}

// Bloki eksploracyjne: po spełnieniu wymagań punkty = 1 (ważne tylko, gdy autor nada im wagę > 0).
function weightPoints(block: Block): Partial<BlockEntry> {
  return weightOf(block) > 0 ? { points: 1, correct: true } : {};
}

export interface Reaction {
  /** Przestarzałe (D-096): tylko ze starszych wersji treści; odtwarzacz od D-093 pokazuje sam tekst. */
  pose?: string;
  text: string;
}

interface ReactionResultEntry {
  pose?: string;
  text: string;
  when?: 'correct' | 'incorrect';
  minScore?: number;
}

/**
 * Reakcja maskotki na WYNIK bloku ocenianego (schemaVersion 4, packages/content: baseShape.reactions.result). Pole jest
 * `secret` (FIELD_CLASSIFICATION) - nie ma go w treści z `/start` - więc wolno je czytać wprost z pełnego `block` po stronie
 * serwera, dopiero gdy wynik jest znany (ten sam wzorzec co `emailDetail`/`orderingDetail`/`solution`/`hints[]`: NIGDY przed
 * odpowiedzią). SCORED_BLOCK_TYPES/WHEN_BASED_TYPES to te same stałe, którymi semantics.ts (packages/content) waliduje treść
 * modułu przy imporcie, więc wybór tutaj zawsze trafia w kształt, jaki walidacja zagwarantowała.
 */
export function pickReaction(block: Block, entry: Pick<BlockEntry, 'correct' | 'points'>): Reaction | undefined {
  if (!(SCORED_BLOCK_TYPES as readonly string[]).includes(block.type)) return undefined;
  const result = (block.reactions as { result?: ReactionResultEntry[] } | undefined)?.result;
  if (!Array.isArray(result) || result.length === 0) return undefined;
  let match: ReactionResultEntry | undefined;
  if (WHEN_BASED_TYPES.has(block.type)) {
    if (entry.correct === undefined) return undefined; // nierozstrzygnięte (np. próba z zostałymi próbami) - jeszcze bez reakcji
    const when = entry.correct ? 'correct' : 'incorrect';
    match = result.find((candidate) => candidate.when === when);
  } else if (entry.points !== undefined) {
    const points = entry.points;
    // Lista malejąca (semantics.ts to waliduje przy imporcie): pierwszy wpis, którego próg jest osiągnięty, wygrywa.
    match = result.find((candidate) => typeof candidate.minScore === 'number' && candidate.minScore <= points);
  }
  // Wyłącznie text (+ przestarzała pose, jeśli treść ją ma - D-096): `when`/`minScore` to wewnętrzny klucz doboru reakcji, nie
  // treść do pokazania (i tak jest tylko w sekrecie serwera, ale odpowiedź API ma nieść dokładnie to, co ma pokazać klient, nic
  // więcej - biała lista jak toClientBlock).
  return match ? { ...(match.pose !== undefined ? { pose: match.pose } : {}), text: match.text } : undefined;
}

export function emailPoints(scoring: string | undefined, totalCorrect: number, hits: number, wrong: number): number {
  if (scoring === 'exact') return hits === totalCorrect && wrong === 0 ? 1 : 0;
  if (totalCorrect === 0) return wrong === 0 ? 1 : 0;
  return Math.max(0, (hits - wrong) / totalCorrect);
}

// --- TEXT_INPUT_GUIDED --------------------------------------------------------------------------------------------------

export interface AttemptResponse {
  blockId: string;
  correct: boolean;
  attempt: number;
  attemptsLeft: number;
  done: boolean;
  points?: number;
  hint?: { text: string; narration?: unknown };
  solution?: { text: string; explanation?: string };
  reaction?: Reaction;
}

export function normalizeText(
  input: string,
  rules: { trim?: boolean; collapseWhitespace?: boolean; caseSensitive?: boolean },
): string {
  let value = input;
  if (rules.trim !== false) value = value.trim();
  if (rules.collapseWhitespace !== false) value = value.replace(/\s+/g, ' ');
  if (!rules.caseSensitive) value = value.toLowerCase();
  return value;
}

export function isTextCorrect(block: Block, input: string): boolean {
  const caseSensitive = block.answer?.caseSensitive === true;
  const rules = { ...(block.normalize ?? {}), caseSensitive };
  const value = normalizeText(input, rules);
  const accept: string[] = Array.isArray(block.answer?.accept) ? block.answer.accept : [];
  if (accept.some((candidate) => normalizeText(candidate, rules) === value)) return true;
  if (typeof block.answer?.regex === 'string') {
    // Silnik RE2 (czas liniowy, bez nawrotu): żaden wzorzec z treści nie zawiesi procesu (ReDoS). TEN SAM silnik waliduje wzorzec
    // przy imporcie modułu, więc co przeszło walidację, da się dopasować. Dopasowanie obejmuje CAŁĄ odpowiedź (^(?:...)$), a
    // limity długości wzorca (200) i odpowiedzi (MAX_TEXT_ANSWER, sprawdzany w evaluateAttempt przed dopasowaniem) są drugim
    // bezpiecznikiem.
    return compileAnswerRegex(block.answer.regex, caseSensitive).test(value);
  }
  return false;
}

export function attemptPoints(attemptNumber: number, penalty: number, floor: number): number {
  return Math.max(floor, 1 - (attemptNumber - 1) * penalty);
}

/** Jedna próba odpowiedzi. Rozstrzyga blok przy poprawnej odpowiedzi albo po wyczerpaniu prób (wtedy odsłania rozwiązanie). */
export function evaluateAttempt(
  block: Block,
  input: string,
  existing: BlockEntry | undefined,
  now: Date,
): { entry: BlockEntry; response: AttemptResponse } {
  if (input.length > MAX_TEXT_ANSWER) throw new BadRequestException('Odpowiedź jest zbyt długa');
  if (existing?.done) throw new BadRequestException('To zadanie jest już rozstrzygnięte');

  const maxAttempts: number = block.maxAttempts ?? 4;
  const attemptNumber = (existing?.attempts ?? 0) + 1;
  const hints: { text: string; narration?: unknown }[] = Array.isArray(block.hints) ? block.hints : [];
  const correct = isTextCorrect(block, input);
  const exhausted = !correct && attemptNumber >= maxAttempts;
  const done = correct || exhausted;

  const scoring = block.scoring ?? {};
  const points = correct ? attemptPoints(attemptNumber, scoring.attemptPenalty ?? 0.25, scoring.floor ?? 0.25) : 0;

  // Podpowiedź przysługuje po błędnej próbie (n-ta błędna próba -> n-ta podpowiedź); po rozstrzygnięciu nie ma po co.
  const hint = !done && hints[attemptNumber - 1] ? hints[attemptNumber - 1] : undefined;
  const hintsShown = Math.max(existing?.hintsShown ?? 0, hint ? attemptNumber : 0);

  const entry: BlockEntry = {
    type: block.type,
    done,
    answeredAt: now.toISOString(),
    weight: weightOf(block),
    attempts: attemptNumber,
    hintsShown,
    ...(done ? { correct, points } : {}),
  };

  const response: AttemptResponse = {
    blockId: block.id,
    correct,
    attempt: attemptNumber,
    attemptsLeft: Math.max(0, maxAttempts - attemptNumber),
    done,
    ...(done ? { points } : {}),
    ...(hint ? { hint } : {}),
    ...(exhausted ? { solution: block.solution } : {}),
  };
  return { entry, response };
}
