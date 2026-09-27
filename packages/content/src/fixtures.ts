import { BlockType } from './blocks';

// Fixtury TYLKO do testów (packages/content i apps/api): po jednym, w pełni wypełnionym bloku każdego typu. Każde pole
// sekretne ma wartość z markerem SEKRET (testy szukają go w odpowiedzi /start) albo jest liczbą/boolem (sprawdzane po ścieżkach).
export const SECRET_MARKER = 'SEKRET';

// Celowo BEZ spokenText: to jedyna fixtura, z której korzysta też scripts/content (packages/content/dist/fixtures.js,
// przez fullModule()) - jej testy sidecar/cues zakładają, że każda narracja tego modułu NAPRAWDĘ generuje cues z TTS
// (spokenText, gdy jest, celowo je pomija - patrz pipeline.ts). spokenText do testów klasyfikacji dokłada WYŁĄCZNIE
// leakProbeBlocks() niżej (osobna funkcja, ten sam wzorzec co nadpisanie reactions.result).
const audio = (name: string) => ({
  text: `Narracja ${name}. Drugie zdanie.`,
  audioUrl: `audio/${name}.mp3`,
  durationMs: 1200,
  cues: [
    { text: `Narracja ${name}.`, startMs: 0 },
    { text: 'Drugie zdanie.', startMs: 600 },
  ],
});

function base(id: string) {
  return {
    id,
    title: `Blok ${id}`,
    narration: audio(id),
    mascot: { pose: 'pointing' as const, text: 'Uważaj!' },
    weight: 2,
    // reactions.complete (schemaVersion 4): client, więc bezpieczne na KAŻDYM typie bloku (wywołuje je klient po ukończeniu).
    reactions: { complete: { pose: 'cheer' as const, text: 'Zebrane!' } },
  };
}

/** reactions.result (schemaVersion 4) dla bloków OCENIANYCH: dokłada się do `base(id).reactions`, więc `complete` zostaje. */
const scoredReactions = (result: { pose: 'cheer' | 'warning' | 'thinking'; text: string; when?: 'correct' | 'incorrect'; minScore?: number }[]) => ({
  complete: { pose: 'cheer' as const, text: 'Zebrane!' },
  result,
});

export function fullBlocks(): Record<BlockType, Record<string, unknown>> {
  return {
    VIDEO: { ...base('wideo'), type: 'VIDEO', url: 'https://example.test/wideo.mp4', durationSeconds: 60 },
    QUIZ: {
      ...base('quiz'),
      type: 'QUIZ',
      prompt: 'Który adres jest podejrzany?',
      options: [
        { text: 'a@bank.pl', correct: false, feedback: `${SECRET_MARKER}-feedback-a` },
        { text: 'a@bank-0.pl', correct: true, feedback: `${SECRET_MARKER}-feedback-b` },
      ],
      reactions: scoredReactions([
        { minScore: 1, pose: 'cheer', text: `${SECRET_MARKER}-quiz-cheer` },
        { minScore: 0, pose: 'warning', text: `${SECRET_MARKER}-quiz-warning` },
      ]),
    },
    BRANCHING_SCENARIO: {
      ...base('scenariusz'),
      type: 'BRANCHING_SCENARIO',
      prompt: 'Co robisz?',
      options: [
        { text: 'Klikam', outcome: 'wrong', feedback: `${SECRET_MARKER}-feedback-x` },
        { text: 'Sprawdzam nadawcę', outcome: 'correct', feedback: `${SECRET_MARKER}-feedback-y` },
      ],
      reactions: scoredReactions([
        { minScore: 1, pose: 'cheer', text: `${SECRET_MARKER}-branching-cheer` },
        { minScore: 0, pose: 'warning', text: `${SECRET_MARKER}-branching-warning` },
      ]),
    },
    DRAG_AND_DROP: {
      ...base('segregacja'),
      type: 'DRAG_AND_DROP',
      prompt: 'Posegreguj',
      items: [{ text: 'Mail 1' }, { text: 'Mail 2' }],
      categories: ['Bezpieczne', 'Phishing'],
    },
    EMBEDDED_HTML: { ...base('html'), type: 'EMBEDDED_HTML', html: '<p>Treść</p>' },
    SCENE_HOTSPOTS: {
      ...base('scena'),
      type: 'SCENE_HOTSPOTS',
      image: 'img/scena.png',
      imageAlt: 'Biuro',
      hotspots: [
        {
          id: 'h1',
          label: 'Monitor',
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          content: 'Kartka z hasłem na monitorze.',
          media: { kind: 'image', src: 'img/kartka-zoom.png', alt: 'Zbliżenie karteczki z hasłem' },
          narration: audio('h1'),
          required: true,
          evidence: true,
          note: { text: 'Hasło na kartce przy monitorze.', kind: 'item' },
        },
        // Opcjonalny "smaczek": bez required (inny hotspot ma jawne required, więc ten nie jest wymagany), bez dowodu.
        {
          id: 'h2',
          label: 'Drzwi',
          x: 50,
          y: 50,
          width: 20,
          height: 20,
          content: 'Drzwi bez zamka.',
          media: { kind: 'document', title: 'Karteczka na drzwiach', lines: ['Nie wchodzić bez pukania.'] },
          required: false,
        },
        // Trzeci hotspot WYŁĄCZNIE po to, żeby fixtura pokrywała wszystkie warianty media (image/audio/document) - bez
        // required/evidence, żeby nie zmieniać liczby dowodów tego bloku (apps/api e2e liczy je na sztywno).
        {
          id: 'h3',
          label: 'Telefon',
          x: 75,
          y: 60,
          width: 15,
          height: 15,
          content: 'Telefon z nieodebranym połączeniem.',
          media: {
            kind: 'audio',
            audioUrl: 'audio/poczta-glosowa.mp3',
            transcript: 'Dzień dobry, tu dział bezpieczeństwa banku...',
            image: 'img/telefon-zoom.png',
            alt: 'Zbliżenie telefonu z nieodebranym połączeniem',
          },
        },
        // Czwarty hotspot: media.kind "scene" (B-086/D-071) - zagnieżdżona mini-scena (np. pulpit komputera zza monitora).
        // Wewnętrzny hotspot NIESIE własne evidence/required (płaska lista dowodów całego bloku) - fixtura wypełnia go w
        // całości (narracja, media, notatka), żeby test kompletności klasyfikacji miał czego szukać.
        {
          id: 'h4',
          label: 'Kalendarz',
          x: 10,
          y: 70,
          width: 15,
          height: 15,
          content: 'Kalendarz z zakreśloną datą.',
          media: {
            kind: 'scene',
            scene: {
              image: 'img/pulpit.png',
              imageAlt: 'Pulpit komputera',
              hotspots: [
                {
                  id: 'h4-outlook',
                  label: 'Outlook',
                  x: 5,
                  y: 5,
                  width: 20,
                  height: 20,
                  content: 'Ikona programu pocztowego.',
                  media: { kind: 'image', src: 'img/mail-na-ekranie.png', alt: 'Podgląd wiadomości e-mail' },
                  narration: audio('h4-outlook'),
                  // required: false (NIE true) - h1 zostaje JEDYNYM required:true w całej (płaskiej) fixturze: test w
                  // module.spec.ts ("required: co najmniej jeden element wymagany") ustawia h1.required = false i
                  // oczekuje błędu "brak required:true" - drugi required:true gdziekolwiek w drzewie by to zamaskował.
                  required: false,
                  evidence: true,
                  note: { text: 'Mail otwarty w programie pocztowym.', kind: 'mail' },
                },
                // Dwa kolejne WYŁĄCZNIE po to, żeby fixtura pokrywała wszystkie warianty media WEWNĄTRZ zagnieżdżonej
                // sceny (jeden inner hotspot może mieć tylko jeden kind naraz) - bez evidence, jak "smaczki" wyżej.
                {
                  id: 'h4-kosz',
                  label: 'Kosz',
                  x: 30,
                  y: 5,
                  width: 15,
                  height: 15,
                  content: 'Pusty kosz systemowy.',
                  media: { kind: 'audio', audioUrl: 'audio/kosz.mp3', transcript: 'Kosz jest pusty.', image: 'img/kosz-zoom.png' },
                },
                {
                  id: 'h4-folder',
                  label: 'Folder',
                  x: 5,
                  y: 30,
                  width: 15,
                  height: 15,
                  content: 'Folder "Faktury".',
                  media: { kind: 'document', title: 'Zawartość folderu', lines: ['faktura_marzec.pdf', 'faktura_kwiecien.pdf'] },
                },
              ],
            },
          },
        },
        // Piąty hotspot: action "next" (drzwi) - kończy blok jak przycisk "Dalej", bez content/media/evidence/note.
        { id: 'h5', label: 'Wyjście', x: 90, y: 5, width: 8, height: 10, action: 'next' },
      ],
      // Przestarzała lista (zgodna z flagami; przy obu wygrywa `required`): fixtura wypełnia każde sklasyfikowane pole.
      requiredHotspots: ['h1'],
    },
    DIALOGUE: {
      ...base('rozmowa'),
      type: 'DIALOGUE',
      character: { name: 'Anna', role: 'Księgowa', avatar: 'img/anna.png', opening: 'Ja naprawdę nic nie zrobiłam.' },
      questions: [
        {
          id: 'q1',
          text: 'Skąd ten mail?',
          lines: [
            { text: 'Przyszedł dziś rano.', narration: audio('q1l1') },
            { text: 'Wyglądał jak od banku.' },
          ],
          answerNarration: audio('q1'),
          note: { text: 'Mail przyszedł rano.', kind: 'mail' },
          evidence: true,
          required: true,
        },
        { id: 'q2', text: 'Kto go wysłał?', answer: 'Nie znam nadawcy.', required: false },
      ],
      requiredQuestions: ['q1'],
    },
    NOTEPAD: { ...base('notatnik'), type: 'NOTEPAD', prompt: 'Przejrzyj notatki.' },
    NARRATIVE: { ...base('otwarcie'), type: 'NARRATIVE', text: 'Wtorek, 9:40. Zniknęło czternaście tysięcy złotych.' },
    EMAIL_ANALYSIS: {
      ...base('mail'),
      type: 'EMAIL_ANALYSIS',
      email: {
        fromName: 'Bank',
        fromAddress: 'support@bank-0.pl',
        to: 'jan.kowalski@example.pl',
        subject: 'Pilne: potwierdź dane',
        body: 'Kliknij link.',
        date: 'pon., 21 wrz 2026, 08:14',
        attachment: { name: 'faktura.pdf', size: '84 KB' },
        links: [{ id: 'l1', text: 'Zaloguj', url: 'https://bank-0.pl/login' }],
      },
      prompt: 'Zaznacz oznaki phishingu.',
      criteria: [
        {
          id: 'c1',
          label: 'Podejrzana domena',
          correct: true,
          explanation: `${SECRET_MARKER}-expl-c1`,
          note: { text: `${SECRET_MARKER}-note-c1`, kind: 'mail' },
          evidence: true,
          target: { kind: 'sender' },
        },
        {
          id: 'c2',
          label: 'Poprawna polszczyzna',
          correct: false,
          explanation: `${SECRET_MARKER}-expl-c2`,
          note: { text: `${SECRET_MARKER}-note-c2`, kind: 'mail' },
          target: { kind: 'text', quote: 'Kliknij' },
        },
        {
          id: 'c3',
          label: 'Presja czasu',
          correct: true,
          explanation: `${SECRET_MARKER}-expl-c3`,
          note: { text: `${SECRET_MARKER}-note-c3`, kind: 'mail' },
          target: { kind: 'link', linkId: 'l1' },
        },
      ],
      scoring: 'partial',
      reactions: scoredReactions([
        { minScore: 0.8, pose: 'cheer', text: `${SECRET_MARKER}-email-cheer` },
        { minScore: 0.4, pose: 'thinking', text: `${SECRET_MARKER}-email-thinking` },
        { minScore: 0, pose: 'warning', text: `${SECRET_MARKER}-email-warning` },
      ]),
    },
    TEXT_INPUT_GUIDED: {
      ...base('domena'),
      type: 'TEXT_INPUT_GUIDED',
      prompt: 'Jaka jest prawdziwa domena w linku?',
      placeholder: 'domena.pl',
      answer: { accept: [`${SECRET_MARKER}-odp`], regex: `^${SECRET_MARKER}-re$`, caseSensitive: false },
      normalize: { trim: true, collapseWhitespace: true },
      hints: [{ text: `${SECRET_MARKER}-podpowiedz-1`, narration: audio('hint1') }],
      maxAttempts: 4,
      scoring: { attemptPenalty: 0.25, floor: 0.25 },
      solution: { text: `${SECRET_MARKER}-rozwiazanie`, explanation: `${SECRET_MARKER}-rozwiazanie-wyjasnienie` },
      reactions: scoredReactions([
        { when: 'correct', pose: 'cheer', text: `${SECRET_MARKER}-text-cheer` },
        { when: 'incorrect', pose: 'warning', text: `${SECRET_MARKER}-text-warning` },
      ]),
    },
    ORDERING: {
      ...base('kolejnosc'),
      type: 'ORDERING',
      prompt: 'Ułóż kroki reakcji.',
      items: [
        { id: 'o1', text: 'Nie klikaj' },
        { id: 'o2', text: 'Zgłoś' },
        { id: 'o3', text: 'Usuń' },
      ],
      scoring: 'partial',
      reactions: scoredReactions([
        { minScore: 1, pose: 'cheer', text: `${SECRET_MARKER}-ordering-cheer` },
        { minScore: 0, pose: 'thinking', text: `${SECRET_MARKER}-ordering-thinking` },
      ]),
      explanation: `${SECRET_MARKER}-kolejnosc-wyjasnienie`,
    },
    TABS: {
      ...base('teczka'),
      type: 'TABS',
      tabs: [
        { id: 't1', title: 'Nadawca', content: 'Dane nadawcy.' },
        { id: 't2', title: 'Nagłówki', content: 'Nagłówki maila.' },
      ],
      requiredTabs: ['t1'],
    },
    // schemaVersion 5. Dwa kroki "call": postać bez avatara (inicjały) i postać z avatarem; każdy rodzaj kroku co najmniej raz.
    BRIEFING: {
      ...base('odprawa'),
      // Nieoceniany: waga musi być 0 (semantics.ts) - pole zostaje, żeby test klasyfikacji widział ścieżkę `weight`.
      weight: 0,
      type: 'BRIEFING',
      steps: [
        { kind: 'typewriter', text: 'Wtorek, 7:58.', sub: 'Dzwoni telefon.', cta: 'Odbierz', narration: audio('odprawa-0') },
        {
          kind: 'call',
          caller: { name: 'Komisarz Adam Wolski', role: 'Wydział Cyberbezpieczeństwa' },
          text: 'Mamy sprawę.',
          cta: 'Słucham',
          // Rola głosu (schemaVersion 5, D-082): Komisarz mówi własnym głosem.
          narration: { ...audio('odprawa-1'), voice: 'komisarz' as const },
        },
        { kind: 'call', caller: { name: 'Marek', avatar: 'avatars/marek.svg' }, text: 'Czekam w IT.', cta: 'Dalej' },
        {
          kind: 'caseFile',
          caseNo: 'SPR-2026-0412',
          title: 'Wyłudzone hasło',
          fields: [{ label: 'Firma', value: 'Firma Testowa' }],
          stamp: 'PILNE',
          // Zadanie sprawy (D-081): odhaczane, gdy ukończone są oba bloki (mail i kolejność).
          tasks: [{ id: 'linki', text: 'Nie klikaj podejrzanych linków.', completeWhen: ['mail', 'kolejnosc'] }],
          cta: 'Przyjmuję',
          narration: audio('odprawa-3'),
        },
        { kind: 'badge', cta: 'Do dzieła', narration: audio('odprawa-4') },
        { kind: 'start', text: 'Firma Testowa, drugie piętro.', cta: 'Wchodzę', narration: audio('odprawa-5') },
      ],
    },
    // schemaVersion 5 (D-083): teczka - dwa dokumenty, jeden wiersz-dowód (wymagany) i zwykłe linijki.
    DOSSIER: {
      ...base('akta'),
      type: 'DOSSIER',
      // Nieoceniany: waga musi być 0 (semantics.ts, D-083) - pole zostaje, żeby test klasyfikacji widział ścieżkę `weight`.
      weight: 0,
      stamp: 'POUFNE',
      documents: [
        {
          id: 'wyciag',
          tab: 'Wyciąg',
          org: 'BANK TESTOWY',
          title: 'Wyciąg z rachunku',
          meta: 'Rachunek firmowy, wtorek',
          columns: ['Godzina', 'Opis', 'Kwota'],
          rows: [
            { id: 'w1', cells: ['08:02', 'Opłata', '-5,00 PLN'] },
            { id: 'w2', cells: ['09:12', 'Przelew', '-100,00 PLN'], evidence: true, required: true, note: { text: 'Przelew 9:12.', kind: 'item' } },
          ],
        },
        { id: 'procedury', tab: 'Procedury', org: 'FIRMA', title: 'Procedury', columns: ['Zasada'], rows: [{ id: 'p1', cells: ['Zgłaszaj.'] }] },
      ],
    },
    SUMMARY: { ...base('podsumowanie'), type: 'SUMMARY', text: 'Dziękujemy.' },
  };
}

/**
 * Jak fullBlocks, ale QUIZ ma w opcjach także `outcome`, a BRANCHING_SCENARIO także `correct` - taki blok NIE przechodzi
 * walidacji modułu, za to pozwala testom wycieku sprawdzić, że projekcja wycina OBIE odmiany klucza (schemat opcji jest
 * wspólny). Tylko do testów projekcji.
 */
export function leakProbeBlocks(): Record<BlockType, Record<string, unknown>> {
  const blocks = fullBlocks();
  for (const option of blocks.QUIZ.options as Record<string, unknown>[]) option.outcome = 'wrong';
  for (const option of blocks.BRANCHING_SCENARIO.options as Record<string, unknown>[]) option.correct = false;
  // reactions.result jest w schemacie na KAŻDYM typie (baseShape), więc klasyfikacja obejmuje go wszędzie - ale semantycznie
  // wolno go mieć tylko blokom ocenianym, i tylko z JEDNYM z when/minScore (semantics.ts, reactionErrors). fullBlocks() trzyma
  // się tej reguły (musi przejść parseModule w fullModule()); TUTAJ, gdzie ważna jest tylko klasyfikacja/projekcja (nie
  // parseModule), nadpisujemy `result` wpisem z OBOMA polami naraz na KAŻDYM typie - inaczej testy klasyfikacji/wycieku
  // (classification.spec.ts) nie miałyby gdzie sprawdzić ścieżki `reactions.result[].when` na typach, których fixtura w
  // fullBlocks() używa tylko `minScore` (i odwrotnie dla TEXT_INPUT_GUIDED).
  for (const [type, block] of Object.entries(blocks)) {
    const reactions = block.reactions as { complete?: unknown; result?: unknown };
    reactions.result = [{ minScore: 0, when: 'incorrect', pose: 'thinking', text: `${SECRET_MARKER}-reaction-${type}` }];
  }
  // spokenText (narration.spokenText, FIELD_CLASSIFICATION: secret) dokładany TYLKO tutaj, nie w audio() - inaczej
  // fullModule() (używany też przez scripts/content) miałby WSZĘDZIE spokenText, a wtedy jego testy sidecar/cues
  // (które zakładają realne, wielozdaniowe cues z TTS) przestałyby mieć czego testować (spokenText celowo pomija cues).
  // media.narration (schemaVersion 5, D-082): nagranie z potoku TTS zamiast pliku. Semantycznie wyklucza się z audioUrl, ale tu
  // (bez parseModule) oba warianty na tych samych hotspotach, żeby test kompletności widział wszystkie ścieżki klasyfikacji.
  const scene = blocks.SCENE_HOTSPOTS as { hotspots: { id: string; media?: Record<string, unknown> }[] };
  const telefon = scene.hotspots.find((h) => h.media?.kind === 'audio')!;
  telefon.media!.narration = audio('telefon-media');
  const inner = scene.hotspots.flatMap((h) => ((h.media?.scene as { hotspots?: { media?: Record<string, unknown> }[] })?.hotspots ?? []));
  inner.find((h) => h.media?.kind === 'audio')!.media!.narration = audio('kosz-media');
  for (const block of Object.values(blocks)) injectSpokenText(block);
  return blocks;
}

/** Dokłada narration.spokenText (marker SEKRET) do KAŻDEGO obiektu narracji (rozpoznawanego jak w scripts/content: ma
 * `text` i `audioUrl`) w drzewie bloku - rekurencyjnie, więc obejmuje narration, hotspots[].narration,
 * questions[].lines[].narration, questions[].answerNarration i hints[].narration bez wymieniania ich z osobna. */
function injectSpokenText(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(injectSpokenText);
    return;
  }
  if (node && typeof node === 'object') {
    const object = node as Record<string, unknown>;
    if (typeof object.text === 'string' && 'audioUrl' in object && 'durationMs' in object && !('spokenText' in object)) {
      object.spokenText = `${SECRET_MARKER}-spoken-${String(object.audioUrl).replace(/\W+/g, '-')}`;
      // voice (schemaVersion 5, D-082): tak samo "tylko dla TTS" jak spokenText - ścieżka musi istnieć, żeby test ją widział.
      object.voice = 'bank';
    }
    Object.values(object).forEach(injectSpokenText);
  }
}

/**
 * Kompletny moduł (każdy typ raz, SUMMARY na końcu) - do testów walidacji i importu. BRIEFING i DOSSIER (schemaVersion 5) stoją
 * TUŻ PRZED SUMMARY, nie na początku: apps/api/test/course-engine.e2e-spec.ts ma twardo zakodowane indeksy bloków (CLAUDE.md, reguła 9).
 */
export function fullModule() {
  const blocks = fullBlocks();
  return {
    schemaVersion: 5 as const,
    slug: 'sprawa-testowa',
    title: 'Sprawa testowa',
    subtitle: 'Podtytuł testowy',
    category: 'EMAIL_SECURITY' as const,
    level: 'basic' as const,
    durationMinutes: 10,
    mandatory: false,
    objectives: ['Rozpoznać phishing', 'Nie klikać podejrzanych linków'],
    blocks: [
      blocks.NARRATIVE,
      blocks.VIDEO,
      blocks.QUIZ,
      blocks.BRANCHING_SCENARIO,
      blocks.DRAG_AND_DROP,
      blocks.EMBEDDED_HTML,
      blocks.SCENE_HOTSPOTS,
      blocks.DIALOGUE,
      blocks.NOTEPAD,
      blocks.EMAIL_ANALYSIS,
      blocks.TEXT_INPUT_GUIDED,
      blocks.ORDERING,
      blocks.TABS,
      blocks.BRIEFING,
      blocks.DOSSIER,
      blocks.SUMMARY,
    ],
  };
}
