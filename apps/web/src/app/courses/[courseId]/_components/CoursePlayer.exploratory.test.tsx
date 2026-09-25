import { describe, it, expect, vi, afterEach } from 'vitest';
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

describe('CoursePlayer: śledztwo (dowody, maskotka)', () => {
  afterEach(() => {
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

  it('licznik startuje z serwera, dowód z hotspotu podbija go od razu, maskotka się cieszy, odpowiedź niesie noted, a po zapisie liczby są z serwera', async () => {
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
    // Domyślna poza spoczynkowa dla scen z punktami.
    expect(screen.getByAltText('Maskotka Unfooly wskazuje')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Monitor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj do notatnika' }));
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/1');
    expect(screen.getByAltText('Maskotka Unfooly się cieszy')).toBeInTheDocument();
    expect(screen.getByText('Mamy dowód! Trafił do notatnika.')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj do notatnika' }));
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/1');

    fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
    expect(screen.getByTestId('review-block')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Monitor' })).not.toBeInTheDocument(); // Wstecz pokazuje INNY (wcześniejszy) blok
    fireEvent.click(screen.getByRole('button', { name: /^Dalej$/ }));

    // Ten sam blok, ten sam stan: "W notatniku ✓", wszystko obejrzane, licznik bez zmian.
    expect(screen.getByText('W notatniku ✓')).toBeInTheDocument();
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

  it('autor może nadpisać pozę spoczynkową w treści (block.mascot wygrywa z domyślną dla typu)', () => {
    const base = sceneCourse();
    const blocks = [{ ...base.contentBlocks[0], mascot: { pose: 'thinking', text: 'Rozejrzyj się.' } }, base.contentBlocks[1]];
    render(<CoursePlayer courseId="course-1" initial={sceneCourse({ contentBlocks: blocks })} narrationEnabled={false} />);
    expect(screen.getByAltText('Maskotka Unfooly się zastanawia')).toBeInTheDocument();
    expect(screen.queryByAltText('Maskotka Unfooly wskazuje')).not.toBeInTheDocument();
    expect(screen.getByText('Rozejrzyj się.')).toBeInTheDocument();
  });

  it('maskotka sceny bez tekstu w treści dostaje domyślny tekst dymka (nigdy sama, jakby wskazywała w pustkę)', () => {
    render(<CoursePlayer courseId="course-1" initial={sceneCourse()} narrationEnabled={false} />);
    expect(screen.getByTestId('mascot-says')).toHaveTextContent('Rozejrzyj się. Kliknij to, co wygląda podejrzanie.');
  });

  it('tekst maskotki z treści bloku nadpisuje domyślny', () => {
    const base = sceneCourse();
    const blocks = [{ ...base.contentBlocks[0], mascot: { pose: 'pointing', text: 'Zajrzyj pod biurko.' } }, base.contentBlocks[1]];
    render(<CoursePlayer courseId="course-1" initial={sceneCourse({ contentBlocks: blocks })} narrationEnabled={false} />);
    expect(screen.getByTestId('mascot-says')).toHaveTextContent('Zajrzyj pod biurko.');
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

  it('fix/course-finish-flow: ukończenie kursu na SUMMARY idzie OD RAZU na SummaryScreen (jak przy QUIZ na końcu kursu) - bez ekranu pośredniego "Blok ukończony."/"Zobacz podsumowanie", które SUMMARY wcześniej celowo dostawało (usunięty wyjątek)', async () => {
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
        lastResult: { blockIndex: 1, blockId: 'wnioski', type: 'SUMMARY' },
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

    expect(await screen.findByRole('heading', { level: 1, name: 'Sprawa zamknięta' })).toBeInTheDocument();
    expect(screen.queryByText('Blok ukończony.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zobacz podsumowanie' })).not.toBeInTheDocument();
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
    expect(screen.getByAltText('Maskotka Unfooly ostrzega')).toBeInTheDocument(); // zła odpowiedź: warning

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
