import { BlockType } from './blocks';

// Fixtury TYLKO do testów (packages/content i apps/api): po jednym, w pełni wypełnionym bloku każdego typu. Każde pole
// sekretne ma wartość z markerem SEKRET (testy szukają go w odpowiedzi /start) albo jest liczbą/boolem (sprawdzane po ścieżkach).
export const SECRET_MARKER = 'SEKRET';

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
  };
}

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
    },
    BRANCHING_SCENARIO: {
      ...base('scenariusz'),
      type: 'BRANCHING_SCENARIO',
      prompt: 'Co robisz?',
      options: [
        { text: 'Klikam', outcome: 'wrong', feedback: `${SECRET_MARKER}-feedback-x` },
        { text: 'Sprawdzam nadawcę', outcome: 'correct', feedback: `${SECRET_MARKER}-feedback-y` },
      ],
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
          narration: audio('h1'),
          required: true,
          evidence: true,
          note: { text: 'Hasło na kartce przy monitorze.', kind: 'item' },
        },
        // Opcjonalny "smaczek": bez required (inny hotspot ma jawne required, więc ten nie jest wymagany), bez dowodu.
        { id: 'h2', label: 'Drzwi', x: 50, y: 50, width: 20, height: 20, content: 'Drzwi bez zamka.', required: false },
      ],
      // Przestarzała lista (zgodna z flagami; przy obu wygrywa `required`): fixtura wypełnia każde sklasyfikowane pole.
      requiredHotspots: ['h1'],
    },
    DIALOGUE: {
      ...base('rozmowa'),
      type: 'DIALOGUE',
      character: { name: 'Anna', role: 'Księgowa', avatar: 'img/anna.png' },
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
    EMAIL_ANALYSIS: {
      ...base('mail'),
      type: 'EMAIL_ANALYSIS',
      email: {
        fromName: 'Bank',
        fromAddress: 'support@bank-0.pl',
        subject: 'Pilne: potwierdź dane',
        body: 'Kliknij link.',
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
        },
        { id: 'c2', label: 'Poprawna polszczyzna', correct: false, explanation: `${SECRET_MARKER}-expl-c2`, note: { text: `${SECRET_MARKER}-note-c2`, kind: 'mail' } },
        { id: 'c3', label: 'Presja czasu', correct: true, explanation: `${SECRET_MARKER}-expl-c3`, note: { text: `${SECRET_MARKER}-note-c3`, kind: 'mail' } },
      ],
      scoring: 'partial',
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
  return blocks;
}

/** Kompletny moduł (każdy typ raz, SUMMARY na końcu) - do testów walidacji i importu. */
export function fullModule() {
  const blocks = fullBlocks();
  return {
    schemaVersion: 3 as const,
    slug: 'sprawa-testowa',
    title: 'Sprawa testowa',
    category: 'EMAIL_SECURITY' as const,
    durationMinutes: 10,
    mandatory: false,
    blocks: [
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
      blocks.SUMMARY,
    ],
  };
}
