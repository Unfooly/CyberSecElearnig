import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function course(overrides: Partial<CoursePlayerInitialState> = {}): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Sprawa testowa',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: [
      {
        type: 'TABS',
        id: 'tabs1',
        title: 'Zasady',
        tabs: [
          { id: 'x', title: 'Hasła', content: 'Długie hasła.' },
          { id: 'y', title: 'Maile', content: 'Sprawdzaj linki.' },
        ],
      },
      { type: 'QUIZ', id: 'quiz1', prompt: 'Pytanie?', options: [{ text: 'A' }, { text: 'B' }] },
    ],
    progress: null,
    score: null,
    ...overrides,
  };
}

const progressResponse = {
  ok: true,
  status: 200,
  json: async () => ({
    assignmentId: 'a1',
    status: 'IN_PROGRESS',
    currentBlockIndex: 1,
    score: null,
    completedAt: null,
    lastResult: { blockIndex: 0, blockId: 'tabs1', type: 'TABS', points: 1 },
    gamification: null,
  }),
};

describe('CoursePlayer: śledztwo (dowody, podpowiedzi)', () => {
  // prefers-reduced-motion: zbliżenie przedmiotu (D-086) otwiera się i zamyka bez ruchu kamery, więc synchronicznie.
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({
      ...originalMatchMedia(query),
      matches: query.includes('prefers-reduced-motion: reduce'),
    })) as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const sceneCourse = (overrides: Partial<CoursePlayerInitialState> = {}): CoursePlayerInitialState =>
    course({
      contentBlocks: [
        {
          type: 'SCENE_HOTSPOTS',
          id: 'scena',
          title: 'Biuro',
          image: 'scenes/office.png',
          imageAlt: 'Biuro',
          hotspots: [
            {
              id: 'h1',
              label: 'Monitor',
              x: 10,
              y: 10,
              width: 20,
              height: 20,
              content: 'Kartka z hasłem.',
              required: true,
              evidence: true,
              note: { text: 'Hasło na kartce.', kind: 'item' },
            },
          ],
        },
        { type: 'QUIZ', id: 'quiz1', prompt: 'Pytanie?', options: [{ text: 'A' }, { text: 'B' }] },
      ],
      progress: { v: 2, blocks: {}, notes: [], evidence: { collected: 0, total: 1, perBlock: [{ blockId: 'scena', collected: 0, total: 1 }] } },
      ...overrides,
    });

  it('licznik startuje z serwera, dowód z hotspotu podbija go od razu, podpowiedź o dowodzie, odpowiedź niesie noted, a po zapisie liczby są z serwera', async () => {
    const response = {
      ok: true,
      status: 200,
      json: async () => ({
        assignmentId: 'a1',
        status: 'IN_PROGRESS',
        currentBlockIndex: 1,
        score: null,
        completedAt: null,
        lastResult: { blockIndex: 0, blockId: 'scena', type: 'SCENE_HOTSPOTS', points: 1 },
        evidence: { collected: 1, total: 1, perBlock: [{ blockId: 'scena', collected: 1, total: 1 }] },
        gamification: null,
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    render(<CoursePlayer courseId="course-1" initial={sceneCourse()} narrationEnabled={false} />);

    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 0/1');
    // Domyślna podpowiedź dla scen z punktami (bez postaci, D-093).
    expect(screen.getByTestId('hint-overlay')).toHaveTextContent('Rozejrzyj się. Kliknij to, co wygląda podejrzanie.');

    fireEvent.click(screen.getByRole('button', { name: 'Monitor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zabierz' }));
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/1');
    expect(screen.getByTestId('hint-overlay')).toHaveTextContent('Mamy dowód! Trafił do notatnika.');
    expect(screen.getByRole('button', { name: /Notatnik \(1\)/ })).toBeInTheDocument();

    // "Dalej" w pasku powłoki (nie osobny "Kontynuuj" w bloku): wymagane elementy zebrane, więc jest już aktywne.
    fireEvent.click(screen.getByRole('button', { name: /^Dalej$/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ blockIndex: 0, answer: { visited: ['h1'], noted: ['h1'] } });

    // Bez pośredniego ekranu "Blok ukończony." - od razu kolejny blok.
    await screen.findByText('Pytanie?');
    // Liczby z serwera (1/1), bez podwójnego liczenia dowodu lokalnego.
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/1');
  });

  // Wymiary (jsdom liczy 0x0) tylko dla "Zabierz" i celu lotu; prostokąt nad krawędzią ekranu (y < 0), żeby fokus na "Zabierz" nie
  // uruchamiał przewijania nad dolny pasek (PlayerStage keepFocusAboveBar - jsdom nie ma scrollBy).
  function mockFlightRects() {
    const original = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.textContent === 'Zabierz' || this.hasAttribute('data-evidence-target')) {
        return { left: 10, top: -100, width: 100, height: 40, right: 110, bottom: -60, x: 10, y: -100, toJSON: () => ({}) } as DOMRect;
      }
      return original.call(this);
    });
  }

  it('ruch (D-090): przedmiot bez dowodu i reduced-motion - bez lotu', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const animate = vi.fn(() => ({ onfinish: null, oncancel: null }));
    (Element.prototype as unknown as { animate: unknown }).animate = animate;
    mockFlightRects();
    const flights = () => [...document.querySelectorAll('[data-testid="evidence-flight"]')].map((chip) => chip.textContent);
    const base = sceneCourse();
    const scene = base.contentBlocks[0];
    const withMug = { ...base, contentBlocks: [{ ...scene, hotspots: [...(scene.hotspots ?? []), { id: 'h2', label: 'Kubek', x: 50, y: 50, width: 10, height: 10, content: 'Kubek.' }] }, base.contentBlocks[1]] };
    try {
      const { unmount } = render(<CoursePlayer courseId="course-1" initial={withMug} narrationEnabled={false} />);
      // reduced-motion (beforeEach): dowód trafia do notatnika bez lotu.
      fireEvent.click(screen.getByRole('button', { name: 'Monitor' }));
      fireEvent.click(screen.getByRole('button', { name: 'Zabierz' }));
      expect(flights()).toEqual([]);
      unmount();

      window.matchMedia = originalMatchMedia;
      render(<CoursePlayer courseId="course-1" initial={withMug} narrationEnabled={false} />);
      fireEvent.click(screen.getByRole('button', { name: 'Kubek' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Zabierz' }));
      expect(await screen.findByText('To nie jest dowód w tej sprawie.')).toBeInTheDocument();
      expect(flights()).toEqual([]); // nie dowód - potrząśnięcie, bez lotu
    } finally {
      delete (Element.prototype as unknown as { animate?: unknown }).animate;
      document.querySelectorAll('[data-testid="evidence-flight"]').forEach((chip) => chip.remove());
    }
  });

  it('ruch (D-090): "Zabierz" przy dowodzie bez reduced-motion - lot z nazwą przedmiotu do przycisku Notatnika', async () => {
    vi.stubGlobal('fetch', vi.fn());
    window.matchMedia = originalMatchMedia;
    const animate = vi.fn((..._args: unknown[]) => ({ onfinish: null, oncancel: null }));
    (Element.prototype as unknown as { animate: unknown }).animate = animate;
    mockFlightRects();
    try {
      render(<CoursePlayer courseId="course-1" initial={sceneCourse()} narrationEnabled={false} />);
      fireEvent.click(screen.getByRole('button', { name: 'Monitor' }));
      const take = await screen.findByRole('button', { name: 'Zabierz' });
      fireEvent.click(take);
      const chip = document.querySelector('[data-testid="evidence-flight"]');
      expect(chip).toHaveTextContent('Monitor');
      expect(animate.mock.calls[0][1]).toMatchObject({ duration: 400 });
    } finally {
      delete (Element.prototype as unknown as { animate?: unknown }).animate;
      document.querySelectorAll('[data-testid="evidence-flight"]').forEach((chip) => chip.remove());
    }
  });

  it('Wstecz z niezapisanego bloku i powrót: stan bloku (odwiedzone, noted) przeżywa, licznik i notatnik zgadzają się z tym, co poleci na serwer', async () => {
    const response = {
      ok: true,
      status: 200,
      json: async () => ({
        assignmentId: 'a1',
        status: 'IN_PROGRESS',
        currentBlockIndex: 2,
        score: null,
        completedAt: null,
        lastResult: { blockIndex: 1, blockId: 'scena', type: 'SCENE_HOTSPOTS', points: 1 },
        evidence: { collected: 1, total: 1, perBlock: [{ blockId: 'scena', collected: 1, total: 1 }] },
        gamification: null,
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    const base = sceneCourse();
    const quiz = { type: 'QUIZ' as const, id: 'quiz0', prompt: 'Wcześniejsze pytanie', options: [{ text: 'A' }, { text: 'B' }] };
    render(
      <CoursePlayer
        courseId="course-1"
        narrationEnabled={false}
        initial={sceneCourse({
          currentBlockIndex: 1,
          contentBlocks: [quiz, base.contentBlocks[0], base.contentBlocks[1], base.contentBlocks[1]],
          progress: {
            v: 2,
            blocks: { quiz0: { type: 'QUIZ', done: true, correct: true, points: 1 } },
            notes: [],
            evidence: { collected: 0, total: 1, perBlock: [{ blockId: 'scena', collected: 0, total: 1 }] },
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Monitor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zabierz' }));
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/1');

    fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
    expect(screen.getByTestId('review-block')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Monitor' })).not.toBeInTheDocument(); // Wstecz pokazuje INNY (wcześniejszy) blok
    fireEvent.click(screen.getByRole('button', { name: /^Dalej$/ }));

    // Ten sam blok, ten sam stan: przedmiot "w notatniku", wszystko obejrzane, licznik bez zmian.
    expect(screen.getByRole('button', { name: 'Monitor (w notatniku)' })).toBeInTheDocument();
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/1');
    // Z powrotem na żywym bloku: ten sam "Dalej" w pasku (gotowość przetrwała powrót z podglądu) zapisuje odpowiedź.
    fireEvent.click(screen.getByRole('button', { name: /^Dalej$/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ blockIndex: 1, answer: { visited: ['h1'], noted: ['h1'] } });
  });

  it('łańcuch wysokości sceny (hotfix fix/player-scene-fit/B-100): komórka obszaru bloku ma overflow-clip; wrapper żywego bloku I wrapper podglądu "Wstecz" niosą flex-1/min-h-0/flex-col do korzenia SceneHotspotsBlock - bez tego dostawałby wysokość auto (przed hotfixem: rosła ponad ramkę; z [container-type:size] bez tej poprawki: zapadałaby się do zera)', () => {
    function flexChainDepth(el: HTMLElement): number {
      let depth = 0;
      for (let node = el.parentElement; node; node = node.parentElement) {
        if (['flex-1', 'min-h-0', 'flex-col'].every((c) => node!.classList.contains(c))) depth += 1;
      }
      return depth;
    }

    const base = sceneCourse();
    render(
      <CoursePlayer
        courseId="course-1"
        narrationEnabled={false}
        initial={sceneCourse({
          currentBlockIndex: 1,
          contentBlocks: [base.contentBlocks[0], { ...base.contentBlocks[0], id: 'scena2' }],
          progress: {
            v: 2,
            blocks: { scena: { type: 'SCENE_HOTSPOTS', done: true } },
            notes: [],
            evidence: { collected: 1, total: 1, perBlock: [{ blockId: 'scena', collected: 1, total: 1 }] },
          },
        })}
      />,
    );

    // Żywy blok (drugi hotspot sceny - id inny niż "scena", ale ten sam widoczny "Monitor"): komórka obszaru bloku
    // (contentRef w PlayerStage.tsx) i CO NAJMNIEJ dwa ogniwa flex-1/min-h-0/flex-col między nim a przyciskiem
    // hotspotu - własny korzeń SceneHotspotsBlock ORAZ wrapper w CoursePlayer.tsx (bez tego drugiego ogniwa łańcuch
    // byłby przerwany zwykłym blokowym divem).
    const liveMonitor = screen.getByRole('button', { name: 'Monitor' });
    expect(liveMonitor.closest('.overflow-clip')).not.toBeNull();
    expect(flexChainDepth(liveMonitor)).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));

    // Podgląd ("Wstecz") pokazuje WCZEŚNIEJSZY, ukończony blok sceny - ten sam wymóg dotyczy wrappera ReviewBlock.tsx.
    const reviewBlock = screen.getByTestId('review-block');
    expect(reviewBlock.classList.contains('flex-1')).toBe(true);
    expect(reviewBlock.classList.contains('min-h-0')).toBe(true);
    expect(reviewBlock.classList.contains('flex-col')).toBe(true);
    const reviewMonitor = within(reviewBlock).getByRole('button', { name: 'Monitor' });
    expect(reviewMonitor.closest('.overflow-clip')).not.toBeNull();
    expect(flexChainDepth(reviewMonitor)).toBeGreaterThanOrEqual(2);

    // Wrapper żywego bloku zostaje w DOM (stan przeżywa Wstecz), ale MUSI zostać naprawdę ukryty - kod review tego
    // hotfixu: Tailwind [hidden]{display:none} (preflight) i .flex (utilities) mają RÓWNĄ specyficzność, a .flex
    // ładuje się PO preflight w wygenerowanym CSS, więc .flex by WYGRAŁ z [hidden], gdyby klasa była tu bezwarunkowa
    // - stąd className jest warunkowe na !reviewing, nie samo contentLayout==='scene'. Dwa "Monitor" muszą istnieć w
    // DOM (żywy ukryty + podgląd widoczny), ale tylko jeden jest OSIĄGALNY dla roli bez { hidden: true }.
    expect(screen.getAllByRole('button', { name: 'Monitor', hidden: true })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Monitor' })).toHaveLength(1);
  });

  it('hotfix fix/mascot-overlap: otwarte zbliżenie przedmiotu chowa podpowiedź (nie zasłania "Zabierz"/"Odłóż", nie łapie kliknięć); klik w hotspot zwija dymek od razu; zamknięcie przywraca WYŁĄCZNIE ikonkę (zwiniętą)', () => {
    render(<CoursePlayer courseId="course-1" initial={sceneCourse()} narrationEnabled={false} />);

    const hintRoot = screen.getByTestId('hint-overlay');
    const hintIcon = screen.getByRole('button', { name: 'Pokaż podpowiedź' });
    const bubble = screen.getByRole('status').parentElement as HTMLElement;
    // Domyślna podpowiedź sceny z punktami (DEFAULT_HINT) - dymek widoczny od startu. Korzeń ma pointer-events-none
    // (nie łapie kliknięć w scenę), klikalne są tylko ikona i dymek; przy rozwiniętym dymku ikona jest poza Tab.
    expect(hintRoot.className).toMatch(/pointer-events-none/);
    expect(hintIcon).not.toHaveAttribute('aria-hidden');
    expect(bubble.className).toMatch(/opacity-100/);

    // Klik w hotspot otwiera kartę - overlay-stack niepusty, więc dymek zwija się, a ikonka chowa się/przestaje
    // łapać kliknięcia (punkt 3, "sama interakcja bez żadnej nakładki też zwija dymek", ma osobny test niżej).
    fireEvent.click(screen.getByRole('button', { name: 'Monitor' }));

    expect(bubble.className).toMatch(/opacity-0/);
    expect(bubble.className).toMatch(/pointer-events-none/);
    expect(hintIcon.className).toMatch(/invisible/);
    expect(hintIcon).toHaveAttribute('aria-hidden', 'true');
    expect(hintIcon).toHaveAttribute('tabindex', '-1');
    // Region aria-live zostaje w drzewie dostępności (reakcja pod zbliżeniem zostanie ogłoszona).
    expect(hintRoot).not.toHaveAttribute('aria-hidden');
    expect(within(hintRoot).getByRole('status')).toHaveTextContent('Rozejrzyj się. Kliknij to, co wygląda podejrzanie.');

    // Przyciski zbliżenia ("Zabierz", "Odłóż") są osiągalne i klikalne - podpowiedź faktycznie ich nie zasłania
    // ani nie przechwytuje kliknięcia (gdyby przechwytywała, fireEvent.click poniżej i tak by "trafił" w DOM-owy
    // element pod wskazanym testowym selektorem - to RTL, nie prawdziwy hit-testing przeglądarki - ale asercja na
    // invisible/pointer-events-none wyżej jest tym, co faktycznie to gwarantuje w prawdziwej przeglądarce).
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Zabierz' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Odłóż' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Odłóż' }));

    // Ikonka wraca (widoczna, klikalna, osiągalna), ale dymek ZOSTAJE zwinięty - nie rozwija się sam po zamknięciu karty.
    expect(hintIcon.className).not.toMatch(/invisible/);
    expect(hintIcon).not.toHaveAttribute('aria-hidden');
    expect(hintIcon).not.toHaveAttribute('tabindex');
    expect(bubble.className).toMatch(/opacity-0/);
  });

  it('hotfix fix/mascot-overlap (kod review, druga runda - regresja): przejście "Dalej" na nowy blok z INNĄ podpowiedzią pokazuje dymek od razu, mimo że CoursePlayer.tsx w tym samym momencie programowo przenosi fokus na nagłówek nowego bloku', async () => {
    const response = {
      ok: true,
      status: 200,
      json: async () => ({
        assignmentId: 'a1',
        status: 'IN_PROGRESS',
        currentBlockIndex: 1,
        score: null,
        completedAt: null,
        lastResult: { blockIndex: 0, blockId: 'scena', type: 'SCENE_HOTSPOTS', points: 1 },
        evidence: { collected: 1, total: 1, perBlock: [{ blockId: 'scena', collected: 1, total: 1 }] },
        gamification: null,
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    const base = sceneCourse();
    const quizWithMascot = { ...base.contentBlocks[1], mascot: { pose: 'thinking', text: 'Zastanów się chwilę.' } };
    render(<CoursePlayer courseId="course-1" initial={sceneCourse({ contentBlocks: [base.contentBlocks[0], quizWithMascot] })} narrationEnabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Monitor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zabierz' }));
    fireEvent.click(screen.getByRole('button', { name: /^Dalej$/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await screen.findByText('Pytanie?');

    // Nowy blok, nowa podpowiedź - dymek MUSI być rozwinięty, nie zwinięty przez programowy fokus na
    // nagłówek nowego bloku (headingRef.current?.focus() w CoursePlayer.tsx, ten sam commit co zmiana tekstu).
    expect(screen.getByText('Zastanów się chwilę.')).toBeInTheDocument();
    const bubble = screen.getByRole('status').parentElement as HTMLElement;
    expect(bubble.className).toMatch(/opacity-100/);
  });

  it('hotfix fix/mascot-overlap: interakcja z blokiem BEZ żadnej nakładki overlay-stack (wybór w quizie) też zwija dymek od razu, nie czeka 8 s', () => {
    const quizWithMascot = course({
      contentBlocks: [
        {
          type: 'QUIZ',
          id: 'quiz1',
          prompt: 'Pytanie?',
          options: [{ text: 'A' }, { text: 'B' }],
          mascot: { pose: 'pointing', text: 'Wybierz uważnie.' },
        },
      ],
    });
    render(<CoursePlayer courseId="course-1" initial={quizWithMascot} narrationEnabled={false} />);

    const bubble = screen.getByRole('status').parentElement as HTMLElement;
    expect(bubble.className).toMatch(/opacity-100/);

    // Klik w radio wysyła prawdziwe change (jsdom odtwarza natywne zachowanie inputa) - to właśnie ono, nie żadna
    // nakładka overlay-stack (blok oceniany nie rejestruje żadnej), zwija dymek tutaj.
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));

    expect(bubble.className).toMatch(/opacity-0/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('przestarzała poza z treści (block.mascot.pose) jest ignorowana - żadnego obrazka postaci', () => {
    const base = sceneCourse();
    const blocks = [{ ...base.contentBlocks[0], mascot: { pose: 'thinking', text: 'Rozejrzyj się.' } }, base.contentBlocks[1]];
    render(<CoursePlayer courseId="course-1" initial={sceneCourse({ contentBlocks: blocks })} narrationEnabled={false} />);
    expect(screen.getByTestId('hint-overlay')).toHaveTextContent('Rozejrzyj się.');
    expect(screen.queryByAltText(/Maskotka/)).not.toBeInTheDocument();
    expect(document.querySelector('img[src^="/mascot/"]')).toBeNull();
  });

  it('scena bez podpowiedzi w treści dostaje domyślny tekst dymka', () => {
    render(<CoursePlayer courseId="course-1" initial={sceneCourse()} narrationEnabled={false} />);
    expect(screen.getByTestId('hint-overlay')).toHaveTextContent('Rozejrzyj się. Kliknij to, co wygląda podejrzanie.');
  });

  it('tekst podpowiedzi z treści bloku nadpisuje domyślny', () => {
    const base = sceneCourse();
    const blocks = [{ ...base.contentBlocks[0], mascot: { pose: 'pointing', text: 'Zajrzyj pod biurko.' } }, base.contentBlocks[1]];
    render(<CoursePlayer courseId="course-1" initial={sceneCourse({ contentBlocks: blocks })} narrationEnabled={false} />);
    expect(screen.getByTestId('hint-overlay')).toHaveTextContent('Zajrzyj pod biurko.');
    expect(screen.queryByText('Rozejrzyj się. Kliknij to, co wygląda podejrzanie.')).not.toBeInTheDocument();
  });

  it('na SUMMARY "Dalej" znika z paska: jedynym wyjściem jest przycisk w bloku, Wstecz zostaje', () => {
    const summary = { type: 'SUMMARY' as const, id: 'wnioski', text: 'Koniec.' };
    render(
      <CoursePlayer
        courseId="course-1"
        narrationEnabled={false}
        initial={course({
          currentBlockIndex: 1,
          contentBlocks: [{ type: 'QUIZ', id: 'quiz1', prompt: 'Pytanie?', options: [{ text: 'A' }, { text: 'B' }] }, summary],
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Zakończ szkolenie' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Dalej$/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Ukończ ten blok, aby przejść dalej.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Wstecz/ })).toBeEnabled();
  });

  it('SCENE_HOTSPOTS z "drzwi" (action: "next", B-086/D-071): "Dalej" znika z paska, wyjście idzie przez klik w scenie', async () => {
    const doorBlock = {
      type: 'SCENE_HOTSPOTS' as const,
      id: 'korytarz',
      title: 'Korytarz',
      image: 'scenes/korytarz.png',
      imageAlt: 'Korytarz',
      hotspots: [{ id: 'drzwi', label: 'Wyjście', x: 90, y: 10, width: 8, height: 10, action: 'next' as const }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        assignmentId: 'a1',
        status: 'IN_PROGRESS',
        currentBlockIndex: 1,
        score: null,
        completedAt: null,
        lastResult: { blockIndex: 0, blockId: 'korytarz', type: 'SCENE_HOTSPOTS', points: undefined },
        gamification: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CoursePlayer
        courseId="course-1"
        narrationEnabled={false}
        initial={course({ currentBlockIndex: 0, contentBlocks: [doorBlock, { type: 'QUIZ', id: 'quiz1', prompt: 'Pytanie?', options: [{ text: 'A' }, { text: 'B' }] }] })}
      />,
    );

    // Bez wymaganych elementów poza drzwiami: drzwi są od razu gotowe, ale "Dalej" w pasku NIGDY się nie pojawia
    // (SceneHotspotsBlock z drzwiami nigdy nie woła onReady) - jedynym wyjściem jest klik w scenie.
    expect(screen.queryByRole('button', { name: /^Dalej$/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wyjście' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/courses/course-1/progress',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ blockIndex: 0, answer: { visited: [], noted: [] } }) }),
      ),
    );
  });

  it('fix/course-finish-flow: ukończenie kursu na SUMMARY idzie OD RAZU na ekran zamknięcia sprawy - bez ekranu pośredniego "Blok ukończony."/"Zobacz podsumowanie"; od D-089 bez dymka podpowiedzi (zamiast niego liścik komisarza na raporcie)', async () => {
    const summary = { type: 'SUMMARY' as const, id: 'wnioski', text: 'Koniec.' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        assignmentId: 'a1',
        status: 'COMPLETED',
        currentBlockIndex: 2,
        score: 100,
        completedAt: '2026-01-01T00:00:00.000Z',
        lastResult: { blockIndex: 1, blockId: 'wnioski', type: 'SUMMARY', reaction: { pose: 'cheer', text: 'Sprawa zamknięta na 100%!' } },
        gamification: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CoursePlayer
        courseId="course-1"
        narrationEnabled={false}
        initial={course({
          currentBlockIndex: 1,
          contentBlocks: [{ type: 'QUIZ', id: 'quiz1', prompt: 'Pytanie?', options: [{ text: 'A' }, { text: 'B' }] }, summary],
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Zakończ szkolenie' }));

    const summaryHeading = await screen.findByRole('heading', { level: 2, name: 'Sprawa zamknięta' });
    expect(screen.queryByText('Blok ukończony.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zobacz podsumowanie' })).not.toBeInTheDocument();
    // Ekran feedbacku dla SUMMARY jest pominięty (skipsFeedbackScreen) - fokus ląduje WPROST na widocznym nagłówku
    // ekranu zamknięcia (D-076).
    expect(document.activeElement).toBe(summaryHeading);
    expect(screen.queryByTestId('hint-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hint-bar')).not.toBeInTheDocument();
  });

  it('D-089: SUMMARY z `closing` - świeże ukończenie uruchamia ceremonię raportu, podpis z imienia gracza (moduł bez odprawy też pyta o imię), pasek bez "Wróć do biblioteki", "Rozpocznij od nowa" zostaje', async () => {
    const summary = {
      type: 'SUMMARY' as const,
      id: 'rozwiazanie',
      text: 'Koniec.',
      lessons: ['Sprawdzaj domenę.'],
      closing: {
        image: 'scenes/raport.svg',
        stamp: 'scenes/pieczec.svg',
        note: 'scenes/liscik.svg',
        slots: {
          evidence: { x: 5, y: 30, w: 10, h: 6 },
          time: { x: 20, y: 30, w: 10, h: 6 },
          xp: { x: 35, y: 30, w: 10, h: 6 },
          lessons: { x: 5, y: 45, w: 40, h: 30 },
          signature: { x: 20, y: 80, w: 20, h: 6 },
          stamp: { x: 55, y: 60, w: 30, h: 20 },
          note: { x: 75, y: 30, w: 15, h: 20 },
        },
      },
    };
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/users/me/display-name') return { ok: true, status: 200, json: async () => ({ firstName: 'Anna', lastInitial: 'K' }) };
      if (url === '/api/courses/course-1/progress') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            assignmentId: 'a1',
            status: 'COMPLETED',
            currentBlockIndex: 1,
            score: null,
            completedAt: '2026-01-01T10:14:00.000Z',
            lastResult: { blockIndex: 0, blockId: 'rozwiazanie', type: 'SUMMARY' },
            gamification: { xpGained: 120, newLevel: 1, previousLevel: 1, leveledUp: false, unlockedBadges: [], levelProgressBeforePercent: 0, levelProgressAfterPercent: 40 },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    // Ceremonia wymaga ruchu - bez reduced-motion z beforeEach tego opisu.
    window.matchMedia = originalMatchMedia;

    render(
      <CoursePlayer
        courseId="course-1"
        narrationEnabled={false}
        userEmail="anna.kowalska@firma.pl"
        initial={course({ currentBlockIndex: 0, startedAt: '2026-01-01T10:00:00.000Z', contentBlocks: [summary] })}
      />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/users/me/display-name'));

    fireEvent.click(screen.getByRole('button', { name: 'Zakończ szkolenie' }));

    const closed = await screen.findByTestId('case-closed');
    expect(closed).toHaveAttribute('data-stage', 'intro');
    expect(screen.getByTestId('case-closed-scene')).toBeInTheDocument();
    expect(screen.getByText(/Czas śledztwa: 14 min\. Zdobyte doświadczenie: 120 XP\..*Podpis prowadzącego: Anna K\.$/)).toHaveClass('sr-only');
    expect(screen.getAllByRole('link', { name: 'Wróć do biblioteki' })).toHaveLength(1);
    expect(within(closed).getByRole('link', { name: 'Wróć do biblioteki' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rozpocznij od nowa' })).toBeInTheDocument();
  });

  it('dolny pasek: scroll-padding-bottom obszaru treści (nie całego dokumentu - ramka jest jedynym przewijanym obszarem) z pomiaru paska, sprzątany przy odmontowaniu', () => {
    // Element treści dostajemy PO renderze (setProperty szpiegujemy na jego prototypie, jak dawny test na
    // document.documentElement.style - jsdom bywa niekonsekwentne w zapamiętywaniu nierozpoznanych właściwości
    // CSS, więc sprawdzamy samo wywołanie, nie odczyt wartości).
    const setProperty = vi.spyOn(window.CSSStyleDeclaration.prototype, 'setProperty');
    const removeProperty = vi.spyOn(window.CSSStyleDeclaration.prototype, 'removeProperty');
    const { unmount } = render(<CoursePlayer courseId="course-1" initial={sceneCourse()} narrationEnabled={false} />);
    expect(setProperty).toHaveBeenCalledWith('scroll-padding-bottom', expect.stringMatching(/^\d+px$/));
    unmount();
    expect(removeProperty).toHaveBeenCalledWith('scroll-padding-bottom');
  });

  it('fokus na elemencie zasłoniętym przez dolny pasek przewija OBSZAR TREŚCI (nie window - strona się nie przewija) nad pasek; element nad paskiem i elementy paska nie przewijają', () => {
    render(<CoursePlayer courseId="course-1" initial={sceneCourse()} narrationEnabled={false} />);
    const bar = screen.getByRole('navigation', { name: 'Nawigacja po blokach' }).parentElement as HTMLElement;
    const content = bar.previousElementSibling as HTMLElement;
    const scrollBy = vi.fn();
    content.scrollBy = scrollBy;
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ top: 700, bottom: 760, height: 60 } as DOMRect);
    const monitor = screen.getByRole('button', { name: 'Monitor' });

    vi.spyOn(monitor, 'getBoundingClientRect').mockReturnValue({ top: 650, bottom: 720 } as DOMRect); // dół 20 px pod górną krawędzią paska
    monitor.focus();
    expect(scrollBy).toHaveBeenCalledWith({ top: 28 });

    scrollBy.mockClear();
    vi.spyOn(monitor, 'getBoundingClientRect').mockReturnValue({ top: 600, bottom: 690 } as DOMRect); // nad paskiem
    monitor.blur();
    monitor.focus();
    expect(scrollBy).not.toHaveBeenCalled();

    vi.spyOn(monitor, 'getBoundingClientRect').mockReturnValue({ top: 650, bottom: 720 } as DOMRect);
    screen.getByRole('button', { name: /Wstecz/ }).focus(); // element samego paska: bez przewijania
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('EMBEDDED_HTML: podczas podglądu "Wstecz" w DOM nie ma <iframe> (odmontowany, nie ukryty); po powrocie iframe wraca', () => {
    const embedCourse = course({
      currentBlockIndex: 1,
      contentBlocks: [
        { type: 'QUIZ', id: 'quiz0', prompt: 'Pierwsze?', options: [{ text: 'A' }, { text: 'B' }] },
        { type: 'EMBEDDED_HTML', id: 'gra' },
      ],
      progress: { v: 2, blocks: { quiz0: { type: 'QUIZ', done: true, correct: true, points: 1, answer: 0 } }, notes: [] },
    });
    const { container } = render(<CoursePlayer courseId="course-1" initial={embedCourse} narrationEnabled={false} />);

    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('/api/courses/course-1/blocks/gra/embed');

    fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
    expect(screen.getByTestId('review-block')).toBeInTheDocument();
    expect(container.querySelector('iframe')).toBeNull(); // nie w ukrytym kontenerze: w ogóle nie ma elementu

    fireEvent.click(screen.getByRole('button', { name: /^Dalej$/ }));
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('bez dowodów w module licznik się nie pokazuje', () => {
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    expect(screen.queryByTestId('evidence-counter')).not.toBeInTheDocument();
  });
});

describe('CoursePlayer: bloki oceniane (mail, zadanie tekstowe, podgląd wyboru)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const mailBlock = {
    type: 'EMAIL_ANALYSIS' as const,
    id: 'mail',
    prompt: 'Zaznacz oznaki.',
    email: { fromName: 'Bank', fromAddress: 'a@bank-0.pl', subject: 'Pilne', body: 'Treść wiadomości.', links: [] },
    criteria: [
      { id: 'op-1', label: 'Podejrzany adres', target: { kind: 'sender' as const } },
      { id: 'op-2', label: 'Poprawna polszczyzna', target: { kind: 'subject' as const } },
    ],
  };
  const quiz = { type: 'QUIZ' as const, id: 'quiz0', prompt: 'Pytanie?', options: [{ text: 'Opcja A' }, { text: 'Opcja B' }] };

  const progressResponse = (over: Record<string, unknown>) => ({
    ok: true,
    status: 200,
    json: async () => ({
      assignmentId: 'a1',
      status: 'IN_PROGRESS',
      currentBlockIndex: 2,
      score: 50,
      completedAt: null,
      gamification: null,
      ...over,
    }),
  });

  it('mail: odpowiedź { selected }, wynik w bloku, notatki z serwera od razu w notatniku, a po "Wstecz" wybór gracza i rozstrzygnięcie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      progressResponse({
        lastResult: {
          blockIndex: 1,
          blockId: 'mail',
          type: 'EMAIL_ANALYSIS',
          correct: false,
          points: 0.5,
          detail: {
            criteria: [
              { id: 'op-1', correct: true, selected: true, explanation: 'Domena jest podróbką.' },
              { id: 'op-2', correct: true, selected: false },
            ],
          },
        },
        notes: [{ blockId: 'mail', text: 'Nadawca podszywa się pod bank.', kind: 'mail' }],
        evidence: { collected: 1, total: 2, perBlock: [{ blockId: 'mail', collected: 1, total: 2 }] },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CoursePlayer
        courseId="course-1"
        narrationEnabled={false}
        initial={course({
          currentBlockIndex: 1,
          contentBlocks: [quiz, mailBlock, { type: 'QUIZ', id: 'quiz2', prompt: 'Kolejne?', options: [{ text: 'A' }, { text: 'B' }] }],
          progress: {
            v: 2,
            blocks: { quiz0: { type: 'QUIZ', done: true, correct: true, points: 1, answer: 1 } },
            notes: [],
            evidence: { collected: 0, total: 2, perBlock: [{ blockId: 'mail', collected: 0, total: 2 }] },
          },
        })}
      />,
    );

    // Dowody: suma mail-a znana od startu (D-055 pkt 2), przed odpowiedzią.
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 0/2');
    fireEvent.click(within(screen.getByTestId('mail-client')).getByRole('button', { name: /Bank/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź odpowiedź' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ blockIndex: 1, answer: { selected: ['op-1'] } });

    // Wynik w samym bloku (trafienie, wyjaśnienie), licznik z serwera, notatka z serwera w notatniku.
    await screen.findByText('Domena jest podróbką.');
    expect(screen.getByText(/Wynik: 50%/)).toBeInTheDocument();
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/2');
    expect(screen.getByRole('button', { name: /Notatnik \(1\)/ })).toBeInTheDocument();
    expect(screen.getByTestId('hint-bar')).toHaveTextContent('Uważaj, coś tu nie gra.'); // zła odpowiedź

    // Dwa "Dalej": nieaktywny w powłoce i aktywny pod wynikiem (pierwszy w DOM).
    fireEvent.click(screen.getAllByRole('button', { name: /^Dalej$/ })[0]);
    // Następny blok; "Wstecz" pokazuje mail z wyborem gracza i rozstrzygnięciem (bez ponownego zapisu).
    fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
    const review = screen.getByTestId('review-block');
    expect(within(review).getByRole('button', { name: /Bank/ })).toHaveTextContent('(trafione)');
    expect(within(review).getByRole('button', { name: /Pilne/ })).toHaveTextContent('(przeoczone)');
    expect(within(review).queryByRole('button', { name: 'Sprawdź odpowiedź' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Notatka z serwera dopisała się raz (dedup przy kolejnych renderach i przy podglądzie).
    expect(screen.getByRole('button', { name: /Notatnik \(1\)/ })).toBeInTheDocument();

    // Wcześniejszy quiz: własna odpowiedź.
    fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
    expect(screen.getByText('Opcja B')).toBeInTheDocument();
    expect(screen.getByText(/Twoja odpowiedź:/)).toBeInTheDocument();
  });

  it('zadanie tekstowe: próby idą na /attempt, a "Dalej" po rozstrzygnięciu zapisuje postęp i przechodzi dalej bez osobnego ekranu wyniku', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).endsWith('/attempt')) {
        return { ok: true, status: 200, json: async () => ({ correct: true, attempt: 1, attemptsLeft: 3, done: true, points: 1 }) };
      }
      return progressResponse({
        currentBlockIndex: 1,
        lastResult: { blockIndex: 0, blockId: 'domena', type: 'TEXT_INPUT_GUIDED', correct: true, points: 1 },
      }).json().then((json) => ({ ok: true, status: 200, json: async () => json }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CoursePlayer
        courseId="course-1"
        narrationEnabled={false}
        initial={course({
          currentBlockIndex: 0,
          contentBlocks: [
            { type: 'TEXT_INPUT_GUIDED', id: 'domena', prompt: 'Jaka domena?', maxAttempts: 3, hintCount: 1 },
            { type: 'QUIZ', id: 'quiz2', prompt: 'Kolejne?', options: [{ text: 'A' }, { text: 'B' }] },
          ],
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText('Jaka domena?'), { target: { value: 'bank.pl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź' }));
    await screen.findByText(/Poprawna odpowiedź!/);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/courses/course-1/blocks/domena/attempt');

    // Jeden "Dalej": po rozstrzygnięciu pasek powłoki chowa swój (readySubmit nie dotyczy TEXT_INPUT_GUIDED) zamiast
    // trzymać drugi, nieaktywny obok aktywnego pod wynikiem.
    expect(screen.getAllByRole('button', { name: /^Dalej$/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^Dalej$/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/courses/course-1/progress');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ blockIndex: 0 });
  });

  it('zadanie tekstowe: przed rozstrzygnięciem (jeszcze bez własnego przycisku) "Dalej" w pasku jest nieaktywne z podpowiedzią', () => {
    render(
      <CoursePlayer
        courseId="course-1"
        narrationEnabled={false}
        initial={course({
          currentBlockIndex: 0,
          contentBlocks: [{ type: 'TEXT_INPUT_GUIDED', id: 'domena', prompt: 'Jaka domena?', maxAttempts: 3, hintCount: 1 }],
        })}
      />,
    );
    const forward = screen.getByRole('button', { name: /^Dalej$/ });
    expect(forward).toBeDisabled();
    expect(forward).toHaveAttribute('title', 'Ukończ ten blok, aby przejść dalej.');
  });
});

describe('CoursePlayer: bloki eksploracyjne', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('wysyła { opened } dla bloku TABS przez "Dalej" w pasku (bez osobnego "Kontynuuj" ani ekranu "Blok ukończony."), a po "Wstecz" można przejść blok ponownie bez żadnego zapisu na serwerze', async () => {
    const fetchMock = vi.fn().mockResolvedValue(progressResponse);
    vi.stubGlobal('fetch', fetchMock);
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Maile' }));
    // Wymagane zakładki (x, y) otwarte -> "Dalej" w pasku powłoki jest już aktywne, bez osobnego przycisku w bloku.
    fireEvent.click(screen.getByRole('button', { name: /^Dalej$/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/courses/course-1/progress');
    expect(JSON.parse(init.body)).toEqual({ blockIndex: 0, answer: { opened: ['x', 'y'] } });

    // Bez pośredniego ekranu "Blok ukończony." - jeden klik i już kolejny blok.
    expect(await screen.findByText('Pytanie?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
    expect(screen.getByTestId('review-block')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Maile' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Sprawdzaj linki.');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('NARRATIVE jako PIERWSZY blok (bez żadnej interakcji): "Dalej" w pasku jest aktywne od razu po zamontowaniu - regresja na wyścig efektów (dziecko rejestruje gotowość, rodzic ją zerował w OSOBNYM useEffect na tym samym renderze)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        assignmentId: 'a1',
        status: 'IN_PROGRESS',
        currentBlockIndex: 1,
        score: null,
        completedAt: null,
        lastResult: { blockIndex: 0, blockId: 'n1', type: 'NARRATIVE' },
        gamification: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CoursePlayer
        courseId="course-1"
        narrationEnabled={false}
        initial={course({
          contentBlocks: [
            { type: 'NARRATIVE', id: 'n1', text: 'Pierwszy blok.' },
            { type: 'NARRATIVE', id: 'n2', text: 'Drugi blok.' },
          ],
        })}
      />,
    );

    expect(screen.getByText('Pierwszy blok.')).toBeInTheDocument();
    const next = screen.getByRole('button', { name: /^Dalej$/ });
    expect(next).toBeEnabled();

    fireEvent.click(next);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Drugi NARRATIVE (też "od razu gotowy") musi zdążyć zarejestrować SWOJĄ gotowość po przejściu - "Dalej" znów aktywne.
    await screen.findByText('Drugi blok.');
    expect(screen.getByRole('button', { name: /^Dalej$/ })).toBeEnabled();
  });
});
