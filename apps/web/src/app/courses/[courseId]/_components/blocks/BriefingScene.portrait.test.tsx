import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import BriefingSceneStep, { sceneForOrientation } from './BriefingScene';
import { PORTRAIT_THRESHOLD } from '@/lib/use-portrait-container';
import CaseClosedScreen from '../CaseClosedScreen';
import { SfxProvider } from '@/lib/sfx';
import type { BriefingStep, CaseClosing, CourseCompletionReward } from '@/lib/courses-types';

vi.mock('next/link', async () => {
  const { forwardRef } = await import('react');
  const Link = forwardRef<HTMLAnchorElement, { href: string; children: React.ReactNode }>(({ href, children, ...rest }, ref) => (
    <a ref={ref} href={href} {...rest}>
      {children}
    </a>
  ));
  Link.displayName = 'Link';
  return { default: Link };
});

// Warianty pionowe scen odprawy i raportu (feat/portrait-scenes, D-098): kontener o proporcjach < 0.8 + `portrait` w treści ->
// pionowa grafika i jej prostokąty; inaczej scena pozioma (16:9). jsdom nie liczy układu - rozmiar kontenera podstawiamy.
function mockContainer(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON: () => ({}) } as DOMRect);
}

const caseFile: BriefingStep = {
  kind: 'caseFile',
  caseNo: 'CS/1',
  title: 'Sprawa',
  fields: [{ label: 'A', value: 'B' }],
  tasks: [{ id: 't', text: 'Zadanie.', completeWhen: ['x'] }],
  cta: 'Zamknij teczkę',
  image: 'scenes/akta.svg',
  closedImage: 'scenes/teczka.svg',
  hotspot: { id: 'teczka', x: 24, y: 17, w: 51, h: 69 },
  openHotspot: { id: 'akta', x: 4, y: 2, w: 92, h: 95 },
  slots: { tasks: { x: 54, y: 19, w: 37, h: 56 } },
  portrait: {
    image: 'scenes/akta-pion.svg',
    closedImage: 'scenes/teczka-pion.svg',
    hotspot: { id: 'teczka', x: 4.1, y: 32.3, w: 91.8, h: 39.1 },
    openHotspot: { id: 'akta', x: 12.8, y: 0.6, w: 74.4, h: 99 },
    slots: { tasks: { x: 19.4, y: 59.6, w: 60, h: 28.7 } },
  },
};
const call: BriefingStep = {
  kind: 'call',
  caller: { name: 'Komisarz' },
  text: 'Mamy sprawę.',
  cta: 'Rozłącz',
  image: 'scenes/rozmowa.svg',
  hotspot: { id: 'rozlacz', x: 21.4, y: 72.4, w: 8.5, h: 15.1 },
  portrait: { image: 'scenes/rozmowa-pion.svg', hotspot: { id: 'rozlacz', x: 42, y: 44.4, w: 15.9, h: 9 } },
};

function renderStep(step: BriefingStep, caseOpen = false) {
  return render(
    <BriefingSceneStep
      step={step}
      contentBase="/content"
      reducedMotion
      headingId="h"
      caseOpen={caseOpen}
      onHotspot={() => {}}
      tasks={[{ text: 'Zadanie.', done: false }]}
      identity={{ label: 'Jan P.', initials: 'JP' }}
      caseNo="CS/1"
    />,
  );
}

describe('sceneForOrientation (D-098)', () => {
  it('pion + portrait: obraz, zamknięta teczka, hotspoty i sloty z wariantu pionowego; reszta kroku bez zmian', () => {
    const scene = sceneForOrientation(caseFile, true);
    expect(scene).toMatchObject({
      kind: 'caseFile',
      cta: 'Zamknij teczkę',
      image: 'scenes/akta-pion.svg',
      closedImage: 'scenes/teczka-pion.svg',
      hotspot: { id: 'teczka', x: 4.1 },
      openHotspot: { id: 'akta', x: 12.8 },
      slots: { tasks: { x: 19.4 } },
    });
  });

  it('poziom albo krok bez portrait: ten sam obiekt kroku', () => {
    expect(sceneForOrientation(caseFile, false)).toBe(caseFile);
    const noPortrait = { ...call, portrait: undefined };
    expect(sceneForOrientation(noPortrait, true)).toBe(noPortrait);
  });
});

describe('BriefingSceneStep w pionie (D-098)', () => {
  afterEach(() => vi.restoreAllMocks());

  it(`kontener o proporcjach < ${PORTRAIT_THRESHOLD}: pionowa grafika, hotspot i dymek komisarza w dolnej części (y >= 62%)`, () => {
    mockContainer(360, 640);
    renderStep(call);
    const scene = screen.getByTestId('briefing-scene');
    expect(scene).toHaveAttribute('data-orientation', 'portrait');
    expect(scene.querySelector('img')?.getAttribute('src')).toContain('rozmowa-pion.svg');
    expect(screen.getByTestId('briefing-hotspot')).toHaveStyle({ left: '42%', top: '44.4%' });
    expect(parseFloat(screen.getByTestId('briefing-bubble').style.top)).toBeGreaterThanOrEqual(62);
  });

  it('kontener poziomy: scena pozioma jak dotąd', () => {
    mockContainer(1200, 675);
    renderStep(call);
    expect(screen.getByTestId('briefing-scene')).toHaveAttribute('data-orientation', 'landscape');
    expect(screen.getByTestId('briefing-scene').querySelector('img')?.getAttribute('src')).toContain('rozmowa.svg');
    expect(screen.getByTestId('briefing-hotspot')).toHaveStyle({ left: '21.4%' });
  });

  it('teczka w pionie: zamknięta faza z pionowej grafiki, po otwarciu slot zadań z wariantu pionowego', () => {
    mockContainer(360, 640);
    const { rerender } = renderStep(caseFile);
    expect(screen.getByTestId('briefing-closed-image').getAttribute('src')).toContain('teczka-pion.svg');
    expect(screen.getByTestId('briefing-hotspot')).toHaveStyle({ left: '4.1%', top: '32.3%' });
    rerender(
      <BriefingSceneStep
        step={caseFile}
        contentBase="/content"
        reducedMotion
        headingId="h"
        caseOpen
        onHotspot={() => {}}
        tasks={[{ text: 'Zadanie.', done: false }]}
        identity={{ label: 'Jan P.', initials: 'JP' }}
        caseNo="CS/1"
      />,
    );
    expect(screen.getByTestId('briefing-slot-tasks')).toHaveStyle({ left: '19.4%', top: '59.6%' });
    expect(screen.getByTestId('briefing-hotspot')).toHaveStyle({ left: '12.8%' });
  });

  it('bez pomiaru (kontener nie zmierzony - jak HTML z serwera) scena się nie renderuje; kontener bez wymiarów = poziomo', () => {
    // jsdom: getBoundingClientRect 0x0 -> po pomiarze "poziomo" (scena jest), więc tu tylko sprawdzamy, że wynik to scena pozioma.
    renderStep(call);
    expect(screen.getByTestId('briefing-scene')).toHaveAttribute('data-orientation', 'landscape');
  });

  it('krok bez portrait na telefonie: scena pozioma (letterbox 16:9)', () => {
    mockContainer(360, 640);
    renderStep({ ...call, portrait: undefined });
    expect(screen.getByTestId('briefing-scene')).toHaveAttribute('data-orientation', 'landscape');
  });
});

const closing: CaseClosing = {
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
};

function renderClosing(closingProp: CaseClosing) {
  return render(
    <SfxProvider enabled={false}>
      <CaseClosedScreen title="Sprawa" score={100} closing={closingProp} lessons={['Wniosek.']} signer="Jan P." contentBase="/content" fresh={false} />
    </SfxProvider>,
  );
}

// Obrót telefonu: rozmiar kontenera zmienia się w trakcie życia komponentu (ResizeObserver) - wariant się przełącza, ale ten sam węzeł
// sceny zostaje (bez przemontowania), a stan (faza teczki z propsów, etap ceremonii w stanie komponentu) się nie gubi.
describe('obrót telefonu (D-098, ResizeObserver)', () => {
  let size = { width: 360, height: 640 };
  let callbacks: (() => void)[] = [];
  const rotate = (width: number, height: number) => {
    size = { width, height };
    act(() => callbacks.forEach((callback) => callback()));
  };
  beforeEachSetup();
  function beforeEachSetup() {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.useRealTimers();
      callbacks = [];
    });
  }
  const setup = () => {
    size = { width: 360, height: 640 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ ...size, x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height, toJSON: () => ({}) }) as DOMRect);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
  };

  it('scena odprawy: pion -> poziom -> pion na tym samym węźle, faza teczki z propsów zostaje', () => {
    setup();
    renderStep(caseFile, true);
    const scene = screen.getByTestId('briefing-scene');
    expect(scene).toHaveAttribute('data-orientation', 'portrait');
    expect(scene).toHaveAttribute('data-phase', 'open');
    rotate(640, 360);
    expect(screen.getByTestId('briefing-scene')).toBe(scene);
    expect(scene).toHaveAttribute('data-orientation', 'landscape');
    expect(scene).toHaveAttribute('data-phase', 'open');
    expect(screen.getByTestId('briefing-slot-tasks')).toHaveStyle({ left: '54%' });
    rotate(360, 640);
    expect(scene).toHaveAttribute('data-orientation', 'portrait');
    expect(screen.getByTestId('briefing-slot-tasks')).toHaveStyle({ left: '19.4%' });
  });

  it('ceremonia zamknięcia: obrót w trakcie wystukiwania wniosków nie cofa etapu', () => {
    vi.useFakeTimers();
    setup();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    render(
      <SfxProvider enabled={false}>
        <CaseClosedScreen title="Sprawa" score={100} closing={closing} lessons={['Wniosek pierwszy.']} signer="Jan P." contentBase="/content" fresh />
      </SfxProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    const root = screen.getByTestId('case-closed');
    expect(root).toHaveAttribute('data-stage', 'lessons');
    rotate(640, 360);
    expect(root).toHaveAttribute('data-stage', 'lessons');
    expect(screen.getByTestId('case-closed-frame')).toHaveAttribute('data-orientation', 'landscape');
    // Wystukiwanie to łańcuch timerów przez efekty - małe kroki, każdy w osobnym act (render między timerami).
    for (let i = 0; i < 60; i += 1) {
      act(() => {
        vi.advanceTimersByTime(50);
      });
    }
    expect(root).toHaveAttribute('data-stage', 'sign');
  });
});

describe('CaseClosedScreen w pionie (D-098)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('D-107: wszystkie dane w slotach grafiki (liczby min. 18 px, podpis min. 16 px, wnioski min. 15 px); pod raportem tylko „Następna sprawa”', () => {
    mockContainer(360, 600);
    renderClosing(closing);
    const scene = screen.getByTestId('case-closed-scene');
    const lessons = screen.getByTestId('closing-lessons');
    expect(scene).toContainElement(lessons);
    expect(lessons).toHaveTextContent('1. Wniosek.');
    expect(lessons.style.fontSize).toMatch(/^max\(15px,/);
    for (const id of ['closing-evidence', 'closing-time', 'closing-xp']) {
      const value = screen.getByTestId(id);
      expect(scene).toContainElement(value);
      expect(value.style.fontSize).toMatch(/^max\(18px,/);
      // Prawdziwy tekst raportu (czytelny), nie ozdoba wypalona w grafice.
      expect(value).not.toHaveAttribute('data-graphic-text');
    }
    expect(screen.getByTestId('closing-evidence')).toHaveTextContent('—');
    const signed = screen.getByTestId('closing-signed');
    expect(scene).toContainElement(signed);
    expect(signed).toHaveTextContent('Jan P.');
    expect(signed.style.fontSize).toMatch(/^max\(16px,/);
    // Pod raportem nic poza „Następna sprawa” (bez liczb, wniosków, wyniku zadań i paska poziomu).
    expect(screen.queryByTestId('closing-portrait-details')).not.toBeInTheDocument();
    const actions = screen.getByTestId('case-closed-actions');
    expect(actions).not.toHaveTextContent(/Wynik zadań|Dowody|Czas|Poziom/);
    expect(actions.querySelectorAll('button, a, p, [role="progressbar"]')).toHaveLength(1);
    expect(actions).toHaveTextContent('Następna sprawa · wkrótce');
    // Wynik zadań zostaje dla czytnika - w opisie raportu.
    expect(screen.getByText(/Wynik zadań: 100%\./)).toHaveClass('sr-only');
  });

  const reward: CourseCompletionReward = {
    xpGained: 325,
    previousLevel: 1,
    newLevel: 2,
    leveledUp: true,
    levelProgressBeforePercent: 40,
    levelProgressAfterPercent: 100,
    unlockedBadges: [{ code: 'tropiciel', title: 'Tropiciel wszystkich dowodów', icon: 'badge', xpReward: 50 }],
  };

  it('D-107 z nagrodą: pod raportem nadal tylko „Następna sprawa”, a awans i nowe osiągnięcia są w opisie raportu dla czytnika', () => {
    mockContainer(360, 600);
    render(
      <SfxProvider enabled={false}>
        <CaseClosedScreen title="Sprawa" score={90} reward={reward} closing={closing} lessons={['Wniosek.']} signer="Jan P." contentBase="/content" fresh={false} />
      </SfxProvider>,
    );
    const actions = screen.getByTestId('case-closed-actions');
    expect(actions.querySelectorAll('button, a, p, [role="progressbar"]')).toHaveLength(1);
    expect(actions).not.toHaveTextContent(/Awans|Poziom|odznak/i);
    const report = screen.getByText(/Podpis prowadzącego: Jan P\./);
    expect(report).toHaveClass('sr-only');
    expect(report).toHaveTextContent('Wynik zadań: 90%. Awans na poziom 2. Nowe osiągnięcia: Tropiciel wszystkich dowodów.');
    expect(screen.getByTestId('closing-xp')).toHaveTextContent('+325');
  });

  it('B-127: w pionie nagroda widoczna wzrokowo - toast nad dolnym paskiem przez 2,5 s (aria-hidden: dla czytnika jest opis raportu)', () => {
    vi.useFakeTimers();
    try {
      mockContainer(360, 600);
      render(
        <SfxProvider enabled={false}>
          <CaseClosedScreen title="Sprawa" score={90} reward={reward} closing={closing} lessons={['Wniosek.']} signer="Jan P." contentBase="/content" fresh={false} />
        </SfxProvider>,
      );
      const toast = screen.getByTestId('reward-toast');
      expect(toast).toHaveTextContent('Awans na poziom 2!');
      expect(toast).toHaveTextContent('Nowe osiągnięcie: Tropiciel wszystkich dowodów');
      expect(toast).toHaveAttribute('aria-hidden', 'true');
      // Bez ceremonii (reduced-motion / powrót) - bez animacji wejścia.
      expect(toast.className).not.toMatch(/animate-rise-in/);
      act(() => vi.advanceTimersByTime(2499));
      expect(screen.getByTestId('reward-toast')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByTestId('reward-toast')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('B-127: bez awansu i odznak - bez toastu; poziomo - bez toastu (nagroda pod raportem)', () => {
    mockContainer(360, 600);
    const { unmount } = render(
      <SfxProvider enabled={false}>
        <CaseClosedScreen title="Sprawa" score={90} reward={{ ...reward, leveledUp: false, unlockedBadges: [] }} closing={closing} lessons={['Wniosek.']} signer="Jan P." contentBase="/content" fresh={false} />
      </SfxProvider>,
    );
    expect(screen.queryByTestId('reward-toast')).not.toBeInTheDocument();
    unmount();
    vi.restoreAllMocks();
    mockContainer(1200, 700);
    render(
      <SfxProvider enabled={false}>
        <CaseClosedScreen title="Sprawa" score={90} reward={reward} closing={closing} lessons={['Wniosek.']} signer="Jan P." contentBase="/content" fresh={false} />
      </SfxProvider>,
    );
    expect(screen.queryByTestId('reward-toast')).not.toBeInTheDocument();
  });

  it('D-107: błąd pobrania wyniku zostaje widoczny pod pionowym raportem (to nie dubel danych z grafiki)', () => {
    mockContainer(360, 600);
    render(
      <SfxProvider enabled={false}>
        <CaseClosedScreen title="Sprawa" score={null} scoreUnavailable closing={closing} lessons={['Wniosek.']} signer="Jan P." contentBase="/content" fresh={false} />
      </SfxProvider>,
    );
    expect(screen.getByTestId('case-closed-actions')).toHaveTextContent('Nie udało się pobrać wyniku. Spróbuj odświeżyć stronę.');
  });

  it('poziomo bez zmian: wynik zadań widoczny pod raportem, bez dubla w opisie dla czytnika', () => {
    mockContainer(1280, 720);
    render(
      <SfxProvider enabled={false}>
        <CaseClosedScreen title="Sprawa" score={90} reward={reward} closing={closing} lessons={['Wniosek.']} signer="Jan P." contentBase="/content" fresh={false} />
      </SfxProvider>,
    );
    expect(screen.getByTestId('case-closed-actions')).toHaveTextContent('Wynik zadań: 90%');
    expect(screen.getByTestId('case-closed-actions')).toHaveTextContent('Awans na poziom 2!');
    expect(screen.getByText(/Podpis prowadzącego: Jan P\./)).not.toHaveTextContent('Wynik zadań');
  });

  it('wnioski w pionie rezerwują wysokość pełnego tekstu w trakcie wystukiwania', () => {
    vi.useFakeTimers();
    mockContainer(360, 600);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    render(
      <SfxProvider enabled={false}>
        <CaseClosedScreen title="Sprawa" score={100} closing={closing} lessons={['Wniosek pierwszy.', 'Drugi.']} signer="Jan P." contentBase="/content" fresh />
      </SfxProvider>,
    );
    const items = screen.getByTestId('closing-lessons').querySelectorAll('li');
    // Przed wystukiwaniem: obie linijki już są (niewidoczna kopia pełnego tekstu), widoczna część pusta.
    expect(items).toHaveLength(2);
    expect(items[1].querySelector('.invisible')).toHaveTextContent('2. Drugi.');
    expect(screen.getAllByTestId('closing-lesson-typed').map((el) => el.textContent)).toEqual(['', '']);
    vi.useRealTimers();
  });

  it('pionowy raport 9:16 z pionowymi slotami, „Następna sprawa” pod raportem na pełną szerokość', () => {
    mockContainer(360, 600);
    renderClosing(closing);
    expect(screen.getByTestId('case-closed-frame')).toHaveAttribute('data-orientation', 'portrait');
    const scene = screen.getByTestId('case-closed-scene');
    expect(scene.style.aspectRatio).toBe('9 / 16');
    expect(scene.querySelector('img')?.getAttribute('src')).toContain('raport-pion.svg');
    expect(screen.getByTestId('closing-evidence')).toHaveStyle({ left: '20.6%', top: '17.3%' });
    expect(screen.getByTestId('case-closed-actions').className).toMatch(/\bflex-col\b/);
  });

  it('bez closing.portrait na telefonie: raport 16:9 (panorama) jak dotąd', () => {
    mockContainer(360, 600);
    renderClosing({ ...closing, portrait: undefined });
    expect(screen.getByTestId('case-closed-frame')).toHaveAttribute('data-orientation', 'landscape');
    expect(screen.getByTestId('case-closed-scene').style.aspectRatio).toBe('16 / 9');
  });
});
