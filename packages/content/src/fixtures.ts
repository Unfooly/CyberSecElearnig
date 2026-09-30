import { BlockType } from './blocks';

// Fixtury TYLKO do testów (packages/content i apps/api): po jednym, w pełni wypełnionym bloku każdego typu. Każde pole
// sekretne ma wartość z markerem SEKRET (testy szukają go w odpowiedzi /start) albo jest liczbą/boolem (sprawdzane po ścieżkach).
export const SECRET_MARKER = 'SEKRET';

// Celowo BEZ spokenText: to jedyna fixtura, z której korzysta też scripts/content (packages/content/dist/fixtures.js,
// przez fullModule()) - jej testy sidecar/cues zakładają, że każda narracja tego modułu NAPRAWDĘ generuje cues z TTS
// (spokenText, gdy jest, celowo je pomija - patrz pipeline.ts). spokenText do testów klasyfikacji dokłada WYŁĄCZNIE
// leakProbeBlocks() niżej (osobna funkcja, ten sam wzorzec co nadpisanie reactions.result).
// Tekst narracji bez cyfr (walidacja modułu, D-109: lektor nie czyta cyfr) - cyfry z nazwy słownie („odprawa-1” -> „odprawa-jeden”);
// ścieżka pliku zostaje z nazwą.
const DIGIT_WORDS = ['zero', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'];
const spokenName = (name: string) => name.replace(/\d/g, (digit) => DIGIT_WORDS[Number(digit)]);
const audio = (name: string) => ({
  text: `Narracja ${spokenName(name)}. Drugie zdanie.`,
  audioUrl: `audio/${name}.mp3`,
  durationMs: 1200,
  cues: [
    { text: `Narracja ${spokenName(name)}.`, startMs: 0 },
    { text: 'Drugie zdanie.', startMs: 600 },
  ],
});

function base(id: string) {
  return {
    id,
    title: `Blok ${id}`,
    narration: audio(id),
    tip: 'Sprawdź nadawcę.',
    // Przestarzałe (D-096), ale sklasyfikowane - fixtura musi je wypełniać (test wycieku).
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
          media: { kind: 'image', src: 'img/kartka-zoom.png', imagePortrait: 'img/kartka-zoom-pion.png', alt: 'Zbliżenie karteczki z hasłem' },
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
                  media: { kind: 'image', src: 'img/mail-na-ekranie.png', imagePortrait: 'img/mail-na-ekranie-pion.png', alt: 'Podgląd wiadomości e-mail' },
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
                // Easter egg (D-100) WEWNĄTRZ zagnieżdżonej sceny - okienka z wyróżnieniem; nie dowód, nie wymagany.
                {
                  id: 'h4-gra',
                  label: 'Gra',
                  x: 30,
                  y: 30,
                  width: 15,
                  height: 15,
                  content: 'Ikona gry na służbowym komputerze.',
                  media: {
                    kind: 'popups',
                    items: [
                      { title: 'Wykryto 147 wirusów!', body: 'Twój komputer jest bardzo chory.', button: 'Wylecz za 0 zł', behavior: 'dodge' },
                      { title: 'Pliki zaszyfrowane', body: 'Zapłać, żeby je odzyskać.', button: 'Zapłać teraz', behavior: 'none', countdown: '23:59:59' },
                    ],
                    outro: 'Pirackie gry to częsta droga wirusów do firm.',
                    badge: { id: 'ciekawski', label: 'Ciekawski detektyw' },
                  },
                },
              ],
            },
          },
        },
        // Okienka easter egga (D-100) na hotspocie NAJWYŻSZEGO poziomu (te same pola co wewnątrz sceny). `content` - moduły starszych
        // wersji w testach migracji tracą `media` (pole v4).
        {
          id: 'h6',
          label: 'Laptop',
          x: 40,
          y: 10,
          width: 10,
          height: 10,
          content: 'Laptop z otwartą przeglądarką.',
          media: {
            kind: 'popups',
            items: [{ title: 'Gratulacje!', body: 'Wygrałeś smartfon!', button: 'Odbierz nagrodę', behavior: 'none', countdown: '0:10:00' }],
            outro: 'To tylko ćwiczenie.',
            badge: { id: 'laptop', label: 'Uważny obserwator' },
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
      frame: 'browser',
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
      start: { label: 'A.K.', caption: 'Pracownik' },
      end: { label: '−1 000 zł', caption: 'Strata' },
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
        {
          kind: 'typewriter',
          text: 'Wtorek, 7:58.',
          sub: 'Dzwoni telefon.',
          cta: 'Odbierz',
          narration: audio('odprawa-0'),
          // Grafika kroku (D-084): scena i hotspot = cta.
          image: 'scenes/biurko.svg',
          hotspot: { id: 'telefon', x: 49, y: 21.6, w: 16.3, h: 54.2 },
          // Wariant pionowy (D-098): te same pola w % sceny 9:16.
          portrait: { image: 'scenes/biurko-pion.svg', hotspot: { id: 'telefon', x: 31.1, y: 28.1, w: 37.8, h: 40 } },
        },
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
          // Dwie fazy (D-084): zamknięta teczka z hotspotem -> otwarte akta ze slotem na zadania.
          closedImage: 'scenes/teczka.svg',
          image: 'scenes/akta.svg',
          hotspot: { id: 'teczka', x: 24.4, y: 17.4, w: 51.6, h: 69.5 },
          openHotspot: { id: 'akta', x: 3.9, y: 2.3, w: 92.1, h: 95.3 },
          slots: { tasks: { x: 54.1, y: 19.4, w: 37.1, h: 56.2 } },
          portrait: {
            image: 'scenes/akta-pion.svg',
            closedImage: 'scenes/teczka-pion.svg',
            hotspot: { id: 'teczka', x: 4.1, y: 32.3, w: 91.8, h: 39.1 },
            openHotspot: { id: 'akta', x: 12.8, y: 0.6, w: 74.4, h: 99 },
            slots: { tasks: { x: 19.4, y: 59.6, w: 60, h: 28.7 } },
          },
        },
        {
          kind: 'badge',
          cta: 'Do dzieła',
          narration: audio('odprawa-4'),
          image: 'scenes/legitymacja.svg',
          slots: {
            photo: { x: 55.1, y: 30, w: 11.2, h: 25.3 },
            name: { x: 68.8, y: 33.7, w: 17.4, h: 5.3 },
            number: { x: 68.8, y: 44.9, w: 17.4, h: 5.3 },
          },
          portrait: {
            image: 'scenes/legitymacja-pion.svg',
            slots: {
              photo: { x: 25.3, y: 59.8, w: 18.3, h: 13.1 },
              name: { x: 47.6, y: 61.7, w: 28.4, h: 2.8 },
              number: { x: 47.6, y: 67.5, w: 28.4, h: 2.8 },
            },
          },
        },
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
        { id: 'procedury', tab: 'Procedury', org: 'FIRMA', title: 'Procedury', columns: ['Zasada'], rows: [{ id: 'p1', cells: ['Zgłaszaj.'], message: 'To zasada, nie ślad.' }] },
      ],
    },
    SUMMARY: {
      ...base('podsumowanie'),
      type: 'SUMMARY',
      text: 'Dziękujemy.',
      lessons: ['Sprawdzaj nadawcę.', 'Zgłaszaj podejrzane maile.'],
      closing: {
        image: 'scenes/raport.svg',
        stamp: 'scenes/pieczec.svg',
        note: 'scenes/liscik.svg',
        slots: {
          evidence: { x: 8.8, y: 34.8, w: 11.7, h: 6.8 },
          time: { x: 21.5, y: 34.8, w: 11.7, h: 6.8 },
          xp: { x: 34.2, y: 34.8, w: 11.7, h: 6.8 },
          lessons: { x: 8.8, y: 50.7, w: 37.1, h: 29.3 },
          signature: { x: 23.2, y: 81.8, w: 22.7, h: 6.1 },
          stamp: { x: 56.2, y: 67.7, w: 33, h: 21 },
          note: { x: 78.5, y: 36.6, w: 14.1, h: 23.2 },
        },
        // Wariant pionowy (D-098).
        portrait: {
          image: 'scenes/raport-pion.svg',
          slots: {
            evidence: { x: 20.6, y: 17.3, w: 18.9, h: 3.5 },
            time: { x: 41.1, y: 17.3, w: 18.9, h: 3.5 },
            xp: { x: 61.7, y: 17.3, w: 18.9, h: 3.5 },
            lessons: { x: 20.6, y: 25.4, w: 60, h: 15 },
            signature: { x: 43.9, y: 41.3, w: 36.7, h: 3.1 },
            stamp: { x: 21.7, y: 85.3, w: 55.6, h: 11.3 },
            note: { x: 63.9, y: 62.1, w: 18.9, h: 9.9 },
          },
        },
      },
    },
    // schemaVersion 6 (D-115): tylko w fullModuleV6() - fullModule() zostaje w v5 z tymi samymi indeksami bloków (reguła 9).
    // Segmenty po 1200 ms (audio()), cisza 400 ms po s1: osie czasu s1 0-1200, s2 1600-2800, s3 2800-4000.
    CALL_RECORDING: {
      ...base('nagranie'),
      type: 'CALL_RECORDING',
      segments: [
        { id: 's1', speaker: 'Dzwoniący', narration: { ...audio('nagranie-s1'), voice: 'oszust' }, gapAfterMs: 400 },
        { id: 's2', speaker: 'Karol', narration: { ...audio('nagranie-s2'), voice: 'karol' } },
        { id: 's3', speaker: 'Dzwoniący', narration: { ...audio('nagranie-s3'), voice: 'oszust' } },
      ],
      flags: [
        { segmentId: 's1', category: 'fear' },
        { segmentId: 's3', category: 'code_request' },
      ],
      flagWindowAfterMs: 1500,
      falseTapPenalty: 0.1,
      evidence: [{ id: 'liczba', segmentId: 's3', note: { text: `${SECRET_MARKER}-dowod-liczba`, kind: 'call' } }],
      reactions: scoredReactions([
        { minScore: 1, pose: 'cheer', text: `${SECRET_MARKER}-nagranie-cheer` },
        { minScore: 0, pose: 'warning', text: `${SECRET_MARKER}-nagranie-warning` },
      ]),
    },
    ANNOTATED_REPLAY: {
      ...base('omowienie'),
      type: 'ANNOTATED_REPLAY',
      weight: 0,
      source: { kind: 'transcript', fromBlock: 'nagranie' },
      markers: [
        { n: 1, anchor: { segmentId: 's1' }, title: 'Strach', text: 'W stresie myślimy krócej.', narration: audio('omowienie-m1') },
        { n: 2, anchor: { segmentId: 's3' }, title: 'Parowanie liczb', text: 'Liczbę zna tylko ten, kto się loguje.' },
      ],
    },
    // Przesłuchanie (D-118): fragment-dowód, sprzeczność obalana dowodem nagrania (`nagranie.liczba`, blok wcześniej w fullModuleV6),
    // pytanie otwierające konsolę (dokument z wymaganym wierszem-dowodem).
    INTERROGATION: {
      ...base('przesluchanie'),
      type: 'INTERROGATION',
      character: { name: 'Karol Testowy', role: 'handlowiec', avatar: 'avatars/karol.svg', opening: 'Myślałem, że pomagam.' },
      questions: [
        {
          id: 'glos',
          text: 'Skąd wiedziałeś, kto dzwoni?',
          required: true,
          lines: [
            {
              id: 'glos-1',
              text: 'To był jego głos.',
              narration: { ...audio('przesluchanie-glos-1'), voice: 'karol' },
              fragment: { evidence: true, note: { text: 'Karol rozpoznał głos.', kind: 'person' } },
            },
            { id: 'glos-2', text: 'Na wyświetlaczu było IT Helpdesk.' },
          ],
        },
        {
          id: 'kod',
          text: 'Czy podawałeś jakieś kody?',
          lines: [
            {
              id: 'kod-1',
              text: 'Nie, żadnych kodów.',
              narration: { ...audio('przesluchanie-kod-1'), voice: 'karol' },
              contradiction: {
                refutedBy: 'nagranie.liczba',
                challengeLine: { text: `${SECRET_MARKER}-przyznanie` },
                note: { text: `${SECRET_MARKER}-dowod-przyznanie`, kind: 'person' },
              },
            },
          ],
        },
        { id: 'konsola', text: 'Pokaż konsolę.', required: true, opensDocuments: true, lines: [{ id: 'konsola-1', text: 'Proszę, tu są logowania.' }] },
      ],
      documents: [
        {
          id: 'logowania',
          tab: 'Logowania',
          org: 'KONSOLA ADMINISTRATORA',
          title: 'Logowania konta',
          meta: 'Konto: k.testowy',
          columns: ['Godzina', 'Zdarzenie'],
          rows: [
            { id: 'l1', cells: ['08:55', 'Odrzucone logowanie'], message: 'Odrzucone - to jeszcze nie włamanie.' },
            { id: 'l2', cells: ['09:04', 'Zatwierdzone logowanie, Amsterdam'], evidence: true, required: true, note: { text: 'Logowanie z Amsterdamu.', kind: 'log' } },
          ],
        },
      ],
      reactions: scoredReactions([
        { minScore: 1, pose: 'cheer', text: `${SECRET_MARKER}-przesluchanie-cheer` },
        { minScore: 0, pose: 'warning', text: `${SECRET_MARKER}-przesluchanie-warning` },
      ]),
    },
    // OSINT (D-120): trzy obszary użyte (dwa z dowodem, jeden bez), dwie pułapki, webinar z ukrytym zakończeniem, wariant pionowy.
    OSINT_SPOT: {
      ...base('osint'),
      type: 'OSINT_SPOT',
      image: 'scenes/strona-zespol.svg',
      imagePortrait: 'scenes/strona-zespol-pion.svg',
      imageAlt: 'Strona drukarni, zakładka Zespół.',
      textLayer: [{ id: 't-pawel', x: 9, y: 52, w: 24, h: 6, text: 'Paweł Testowy - IT', style: 'sign', tone: 'dark', portrait: { x: 6, y: 30, w: 80, h: 4 } }],
      prompt: 'Zaznacz informacje, które wykorzystał oszust.',
      spots: [
        { id: 'zespol', label: 'Paweł, IT', x: 8, y: 30, w: 26, h: 34, used: true, note: { text: `${SECRET_MARKER}-dowod-zespol`, kind: 'web' } },
        { id: 'kierownik', label: 'Kierownik sprzedaży', x: 38, y: 30, w: 26, h: 34, used: true },
        {
          id: 'webinar',
          label: 'Webinar',
          x: 70,
          y: 30,
          w: 24,
          h: 30,
          used: true,
          note: { text: `${SECRET_MARKER}-dowod-webinar`, kind: 'web' },
          media: {
            kind: 'audio',
            title: 'Webinar: Bezpieczna praca zdalna',
            narration: { ...audio('osint-webinar'), voice: 'pawel' },
            image: 'scenes/webinar-odtwarzacz.svg',
            imagePortrait: 'scenes/webinar-odtwarzacz-pion.svg',
            alt: 'Kadr prelekcji: slajd i prelegent.',
            textLayer: [{ id: 'slajd', x: 10, y: 10, w: 60, h: 10, text: 'Bezpieczna praca zdalna', style: 'sign', tone: 'light', portrait: { x: 5, y: 10, w: 90, h: 8 } }],
            secretEnding: { id: 'off-the-record', label: 'Off the Record', note: 'Na końcu webinaru padło to, czego nie powinno.' },
          },
        },
        { id: 'godziny', label: 'Godziny otwarcia', x: 70, y: 88, w: 22, h: 6, used: false, trapText: `${SECRET_MARKER}-pulapka-godziny` },
        { id: 'adres', label: 'Adres drukarni', x: 8, y: 88, w: 30, h: 6, used: false, trapText: 'Adres nic oszustowi nie dał.' },
      ],
      portraitSpots: [
        { id: 'zespol', x: 6, y: 20, w: 88, h: 12 },
        { id: 'kierownik', x: 6, y: 34, w: 88, h: 12 },
        { id: 'webinar', x: 6, y: 48, w: 88, h: 12 },
        { id: 'godziny', x: 6, y: 90, w: 88, h: 4 },
        { id: 'adres', x: 6, y: 95, w: 88, h: 4 },
      ],
      falseSpotPenalty: 0.25,
      reactions: scoredReactions([
        { minScore: 1, pose: 'cheer', text: `${SECRET_MARKER}-osint-cheer` },
        { minScore: 0, pose: 'warning', text: `${SECRET_MARKER}-osint-warning` },
      ]),
    },
    // Rozmowa na żywo (D-122): trzy węzły (z ciszą), zakończenia dobre, częściowe i złe; wpisanie liczby i instalacja oddają informację.
    LIVE_CALL: {
      ...base('na-zywo'),
      type: 'LIVE_CALL',
      caller: { display: 'IT Helpdesk', number: '12 3XX XX 41' },
      choiceTimeLimitSec: 12,
      start: 'start',
      nodes: [
        {
          id: 'start',
          narration: { ...audio('na-zywo-start'), voice: 'oszust' },
          choices: [
            { id: 'oddzwonie', text: 'Oddzwonię na numer z intranetu.', next: '#dobre' },
            { id: 'jaka-liczba', text: 'Jaką liczbę mam wpisać?', next: 'nacisk' },
            { id: 'sprawdze', text: 'Poczekaj, sprawdzę, kto dzwoni.', next: 'autorytet' },
          ],
          silence: 'nacisk',
        },
        {
          id: 'nacisk',
          narration: { ...audio('na-zywo-nacisk'), voice: 'oszust' },
          choices: [
            { id: 'rozlaczam', text: 'Rozłączam się.', next: '#dobre' },
            { id: 'wpisuje', text: 'Wpisuję liczbę.', next: '#zle' },
          ],
          silence: '#zle',
        },
        {
          id: 'autorytet',
          narration: { ...audio('na-zywo-autorytet'), voice: 'oszust' },
          choices: [
            { id: 'rozlaczam-2', text: 'Rozłączam się.', next: '#dobre' },
            { id: 'nie-instaluje', text: 'Nie instaluję niczego z telefonu.', next: '#czesciowe' },
            { id: 'instaluje', text: 'Instaluję.', next: '#zle' },
          ],
        },
      ],
      endings: [
        { id: 'dobre', outcome: 'good', narration: { ...audio('na-zywo-dobre'), voice: 'narrator' } },
        { id: 'czesciowe', outcome: 'partial', narration: audio('na-zywo-czesciowe') },
        { id: 'zle', outcome: 'bad', narration: audio('na-zywo-zle') },
        // D-129: osobne dobre zakończenia odrzucenia połączenia i rozłączenia się (nie są celem zwykłych odpowiedzi).
        { id: 'odrzucone', outcome: 'good', narration: audio('na-zywo-odrzucone') },
        { id: 'rozlaczenie', outcome: 'good', narration: audio('na-zywo-rozlaczenie') },
      ],
      infoChoices: ['wpisuje', 'instaluje'],
      reject: '#odrzucone',
      hangUp: '#rozlaczenie',
      reactions: scoredReactions([
        { minScore: 1, pose: 'cheer', text: `${SECRET_MARKER}-na-zywo-cheer` },
        { minScore: 0, pose: 'warning', text: `${SECRET_MARKER}-na-zywo-warning` },
      ]),
    },
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
  // textLayer (schemaVersion 6): na scenie, na zbliżeniu, na scenie zagnieżdżonej i na zbliżeniu w niej - tylko tutaj, fullModule()
  // zostaje w v5 (kształt fixtury pilnują testy e2e, CLAUDE.md reguła 9).
  const layer = (id: string) => [{ id, x: 10, y: 10, w: 30, h: 8, text: `Napis ${id}`, style: 'sign', tone: 'light', portrait: { x: 5, y: 20, w: 60, h: 6 } }];
  const sceneBlock = blocks.SCENE_HOTSPOTS as Record<string, unknown>;
  sceneBlock.textLayer = layer('szyld');
  // Wariant pionowy sceny (D-116) - tylko tutaj (fullModule() bez zmian, reguła 9).
  sceneBlock.imagePortrait = 'img/biuro-pion.svg';
  sceneBlock.portraitHotspots = [{ id: scene.hotspots[0].id, x: 5, y: 10, width: 20, height: 10 }];
  scene.hotspots.find((h) => h.media?.kind === 'image')!.media!.textLayer = layer('zblizenie');
  const nested = scene.hotspots.find((h) => h.media?.kind === 'scene')!.media!.scene as { hotspots: { media?: Record<string, unknown> }[] } & Record<string, unknown>;
  nested.textLayer = layer('pulpit');
  nested.screen = { x: 3, y: 4, w: 90, h: 80 };
  nested.hotspots.find((h) => h.media?.kind === 'image')!.media!.textLayer = layer('ekran');
  // ANNOTATED_REPLAY (D-115): oba warianty źródła i kotwicy naraz (bez parseModule), żeby test kompletności widział wszystkie ścieżki.
  const replay = blocks.ANNOTATED_REPLAY as { source: Record<string, unknown>; markers: { anchor: Record<string, unknown> }[] };
  Object.assign(replay.source, { image: 'scenes/omowienie.svg', imagePortrait: 'scenes/omowienie-pion.svg', alt: 'Omówienie' });
  Object.assign(replay.markers[1].anchor, { x: 40, y: 60 });
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

/**
 * Moduł schemaVersion 6 (D-114/D-115/D-118): fullModule() + nagranie, omówienie i przesłuchanie przed SUMMARY. Osobna funkcja -
 * fullModule() nie zmienia wersji ani indeksów bloków (apps/api/test/course-engine.e2e-spec.ts, CLAUDE.md reguła 9). Razem oba moduły mają
 * każdy typ bloku.
 */
export function fullModuleV6() {
  const base = fullModule();
  const blocks = fullBlocks();
  return {
    ...base,
    schemaVersion: 6 as const,
    slug: 'sprawa-testowa-v6',
    blocks: [
      ...base.blocks.slice(0, -1),
      blocks.CALL_RECORDING,
      blocks.ANNOTATED_REPLAY,
      blocks.INTERROGATION,
      blocks.OSINT_SPOT,
      blocks.LIVE_CALL,
      base.blocks[base.blocks.length - 1],
    ],
  };
}
