import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { toClientBlock, type ContentLocale } from '@cyberszkolo/content';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import CaseClosedScreen from './CaseClosedScreen';
import { OPEN_CASE_LABEL } from './blocks/BriefingScene';
import { SfxProvider } from '@/lib/sfx';
import type { CaseClosing, ContentBlock } from '@/lib/courses-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Grafiki z wpalonym tekstem osobne na język (D-133, i18n-2): treść przygotowana przez serwer w języku gracza (toClientBlock) - obraz sceny
// z pliku tego języka i z opisem alt w tym języku, hotspoty z etykietą dostępną (aria-label) w tym języku.

const scene = {
  id: 'telefon',
  type: 'SCENE_HOTSPOTS',
  tip: { pl: 'Kliknij link.', en: 'Click the link.' },
  image: { pl: 'scenes/pl/telefon.svg', en: 'scenes/en/telefon.svg' },
  imageAlt: { pl: 'Telefon z wiadomością „To Ty?”.', en: 'A phone with the message “Is that you?”.' },
  hotspots: [{ id: 'link', label: { pl: 'Link do filmu', en: 'Video link' }, x: 10, y: 10, width: 30, height: 20, content: { pl: 'Link.', en: 'Link.' } }],
};

// Odprawa: krok ze sceną (alt) i karta sprawy z dwiema grafikami - zamknięta teczka (closedAlt) i otwarte akta (alt).
const briefing = {
  id: 'odprawa',
  type: 'BRIEFING',
  steps: [
    {
      kind: 'typewriter',
      text: { pl: 'Dzwoni telefon.', en: 'The phone rings.' },
      cta: { pl: 'Odbierz telefon', en: 'Answer the phone' },
      image: { pl: 'scenes/pl/biurko.svg', en: 'scenes/en/biurko.svg' },
      alt: { pl: 'Biurko z dzwoniącym telefonem.', en: 'A desk with a ringing phone.' },
      hotspot: { id: 'telefon', x: 49, y: 21.6, w: 16.3, h: 54.2 },
    },
    {
      kind: 'caseFile',
      caseNo: 'CS/2026/0915',
      title: { pl: 'Przelew', en: 'Transfer' },
      fields: [{ label: { pl: 'Strata', en: 'Loss' }, value: '14 000,00 PLN' }],
      tasks: [{ id: 'dowody', text: { pl: 'Zbierz dowody.', en: 'Collect evidence.' }, completeWhen: ['biuro'] }],
      cta: { pl: 'Zamknij teczkę', en: 'Close the file' },
      closedImage: { pl: 'scenes/pl/teczka.svg', en: 'scenes/en/teczka.svg' },
      closedAlt: { pl: 'Zamknięta teczka z napisem „Ściśle tajne”.', en: 'A closed folder marked “Top secret”.' },
      image: { pl: 'scenes/pl/akta.svg', en: 'scenes/en/akta.svg' },
      alt: { pl: 'Otwarte akta sprawy.', en: 'Open case files.' },
      hotspot: { id: 'teczka', x: 24.4, y: 17.4, w: 51.6, h: 69.5 },
      openHotspot: { id: 'akta', x: 3.9, y: 2.3, w: 92.1, h: 95.3 },
      slots: { tasks: { x: 54.1, y: 19.4, w: 37.1, h: 56.2 } },
    },
  ],
};

const clientBlock = (block: Record<string, unknown>, locale: ContentLocale) =>
  toClientBlock(block, { shuffleSeed: () => [1, 2, 3, 4], opaqueId: (_b, i) => i, locale }) as unknown as ContentBlock;

function course(locale: ContentLocale, block: Record<string, unknown> = scene): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Sprawa',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: [clientBlock(block, locale), { type: 'NARRATIVE', id: 'biuro', text: 'Biuro.' }],
    progress: null,
    score: null,
    locale,
    locales: ['pl', 'en'],
  };
}

describe('CoursePlayer: grafiki z tekstem wpalonym w obraz, osobne na język (D-133)', () => {
  it.each([
    ['en', 'scenes/en/telefon.svg', 'A phone with the message “Is that you?”.', 'Video link'],
    ['pl', 'scenes/pl/telefon.svg', 'Telefon z wiadomością „To Ty?”.', 'Link do filmu'],
  ] as const)('%s: obraz z pliku tego języka, alt w tym języku, hotspot z aria-label w tym języku', (locale, file, alt, label) => {
    render(<CoursePlayer courseId="course-1" initial={course(locale)} contentBase="/content" narrationEnabled={false} />);
    const image = screen.getByRole('img', { name: alt });
    expect(image.getAttribute('src')).toContain(file);
    expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
  });

  it.each([
    ['en', 'A desk with a ringing phone.', 'Answer the phone', 'A closed folder marked “Top secret”.', 'Open case files.'],
    ['pl', 'Biurko z dzwoniącym telefonem.', 'Odbierz telefon', 'Zamknięta teczka z napisem „Ściśle tajne”.', 'Otwarte akta sprawy.'],
  ] as const)('%s: odprawa - scena kroku z alt w tym języku; karta sprawy: opis ma tylko grafika widoczna w danej fazie', (locale, deskAlt, cta, closedAlt, openAlt) => {
    render(<CoursePlayer courseId="course-1" initial={course(locale, briefing)} contentBase="/content" narrationEnabled={false} />);
    expect(screen.getByRole('img', { name: deskAlt }).getAttribute('src')).toContain(`scenes/${locale}/biurko.svg`);
    fireEvent.click(screen.getByRole('button', { name: cta }));

    // Faza zamkniętej teczki: opis ma zamknięta teczka, akta pod spodem są dekoracyjne (alt="") - czytnik nie słyszy dwóch obrazów.
    expect(screen.getByTestId('briefing-scene')).toHaveAttribute('data-phase', 'closed');
    expect(screen.getAllByRole('img').map((img) => img.getAttribute('alt'))).toEqual([closedAlt]);
    expect(screen.getByRole('img', { name: closedAlt }).getAttribute('src')).toContain(`scenes/${locale}/teczka.svg`);

    fireEvent.click(screen.getByRole('button', { name: OPEN_CASE_LABEL }));
    expect(screen.getByTestId('briefing-scene')).toHaveAttribute('data-phase', 'open');
    expect(screen.getAllByRole('img').map((img) => img.getAttribute('alt'))).toEqual([openAlt]);
  });

  it('krok odprawy bez alt (treść sprzed D-134, moduły bez locales): obraz dekoracyjny alt="" zamiast nazwy pliku', () => {
    const { alt: _alt, ...withoutAlt } = briefing.steps[0];
    render(<CoursePlayer courseId="course-1" initial={course('pl', { ...briefing, steps: [withoutAlt] })} contentBase="/content" narrationEnabled={false} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('briefing-scene').querySelector('img')).toHaveAttribute('alt', '');
  });
});

describe('CaseClosedScreen: raport, pieczęć i liścik z opisem w języku gracza (D-134)', () => {
  const summary = {
    id: 'raport',
    type: 'SUMMARY',
    lessons: [{ pl: 'Nie klikaj.', en: 'Do not click.' }],
    closing: {
      image: { pl: 'scenes/pl/raport.svg', en: 'scenes/en/raport.svg' },
      alt: { pl: 'Raport z zamknięcia sprawy.', en: 'Case closing report.' },
      stamp: { pl: 'scenes/pl/pieczec.svg', en: 'scenes/en/pieczec.svg' },
      stampAlt: { pl: 'Pieczęć „Sprawa zamknięta”.', en: 'Stamp “Case closed”.' },
      note: { pl: 'scenes/pl/liscik.svg', en: 'scenes/en/liscik.svg' },
      noteAlt: { pl: 'Liścik z podziękowaniem.', en: 'A thank-you note.' },
      slots: Object.fromEntries(['evidence', 'time', 'xp', 'lessons', 'signature', 'stamp', 'note'].map((slot, i) => [slot, { x: 1, y: i * 10, w: 10, h: 5 }])),
    },
  };

  function renderClosing(closing: CaseClosing) {
    return render(
      <SfxProvider enabled={false}>
        <CaseClosedScreen title="Sprawa" score={100} reward={null} closing={closing} lessons={['Nie klikaj.']} evidence={{ collected: 1, total: 1, perBlock: [] }} signer="Jan P." contentBase="/content" fresh={false} />
      </SfxProvider>,
    );
  }

  it.each([
    ['en', 'Case closing report.', 'Stamp “Case closed”.', 'A thank-you note.'],
    ['pl', 'Raport z zamknięcia sprawy.', 'Pieczęć „Sprawa zamknięta”.', 'Liścik z podziękowaniem.'],
  ] as const)('%s: każda grafika raportu z plikiem i opisem w tym języku', (locale, alt, stampAlt, noteAlt) => {
    const { closing } = clientBlock(summary, locale) as unknown as { closing: CaseClosing };
    renderClosing(closing);
    expect(screen.getByRole('img', { name: alt }).getAttribute('src')).toContain(`scenes/${locale}/raport.svg`);
    expect(screen.getByRole('img', { name: stampAlt }).getAttribute('src')).toContain(`scenes/${locale}/pieczec.svg`);
    expect(screen.getByRole('img', { name: noteAlt }).getAttribute('src')).toContain(`scenes/${locale}/liscik.svg`);
  });

  it('raport bez opisów (moduły bez locales): grafiki dekoracyjne alt=""', () => {
    const { closing } = clientBlock(summary, 'pl') as unknown as { closing: CaseClosing };
    const { alt: _a, stampAlt: _s, noteAlt: _n, ...withoutAlts } = closing;
    renderClosing(withoutAlts);
    for (const testId of ['closing-stamp', 'closing-note']) expect(screen.getByTestId(testId)).toHaveAttribute('alt', '');
    expect(screen.queryByRole('img', { name: /./ })).not.toBeInTheDocument();
  });
});
