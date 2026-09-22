import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import EmailAnalysisBlock, { bodySegments } from './EmailAnalysisBlock';
import { MascotReactionProvider, useMascotReaction } from '../player/mascot-reaction';
import type { ContentBlock } from '@/lib/courses-types';

// Id kryteriów są nieprzejrzyste (jak z /start); tu proste, byle nie "c1".
const block: ContentBlock = {
  type: 'EMAIL_ANALYSIS',
  id: 'mail',
  prompt: 'Zaznacz oznaki phishingu.',
  email: {
    fromName: 'Bank Zaufany',
    fromAddress: 'support@bank-0.pl',
    subject: 'Pilne: potwierdź dane logowania',
    body: 'Szanowny kliencie,\nTwoje konto zostanie zablokowane. Kliknij tutaj aby potwierdzić dane.\nPozdrawiamy',
    date: 'pon., 21 wrz 2026, 08:14',
    attachment: { name: 'faktura.pdf', size: '84 KB' },
    links: [
      { id: 'l1', text: 'Kliknij tutaj', url: 'https://bank-0.pl/login?u=1' },
      { id: 'l2', text: 'Regulamin', url: 'https://bank-0.pl/regulamin' },
    ],
  },
  criteria: [
    { id: 'k-sender', label: 'Podejrzany adres nadawcy', target: { kind: 'sender' } },
    { id: 'k-subject', label: 'Presja czasu w temacie', target: { kind: 'subject' } },
    { id: 'k-link', label: 'Link prowadzi do obcej domeny', target: { kind: 'link', linkId: 'l1' } },
    { id: 'k-att', label: 'Nieoczekiwany załącznik', target: { kind: 'attachment' } },
    { id: 'k-text', label: 'Groźba zablokowania konta', target: { kind: 'text', quote: 'Twoje konto zostanie zablokowane' } },
    { id: 'k-general', label: 'Ogólny, bezosobowy ton' },
  ],
};

const list = () => screen.getByRole('group', { name: /Zaznaczone oznaki/ });
const checkbox = (name: RegExp | string) => within(list()).getByRole('checkbox', { name });

function setup(overrides: { result?: Parameters<typeof EmailAnalysisBlock>[0]['result']; onContinue?: () => void; continueLabel?: string } = {}) {
  const onSubmit = vi.fn();
  function Probe() {
    return <output data-testid="reaction">{useMascotReaction().reaction?.pose ?? ''}</output>;
  }
  render(
    <MascotReactionProvider resetKey="k">
      <EmailAnalysisBlock block={block} onSubmit={onSubmit} disabled={false} {...overrides} />
      <Probe />
    </MascotReactionProvider>,
  );
  return onSubmit;
}

describe('EmailAnalysisBlock: makieta klienta pocztowego', () => {
  it('pokazuje nadawcę z nazwą i adresem, datę, temat, treść i załącznik jako w skrzynce', () => {
    setup();
    const mail = screen.getByTestId('mail-client');
    expect(within(mail).getByText('Bank Zaufany')).toBeInTheDocument();
    expect(within(mail).getByText('<support@bank-0.pl>')).toBeInTheDocument();
    expect(within(mail).getByText('pon., 21 wrz 2026, 08:14')).toBeInTheDocument();
    expect(within(mail).getByRole('heading', { name: /Pilne: potwierdź dane logowania/ })).toBeInTheDocument();
    expect(within(mail).getByText(/Szanowny kliencie/)).toBeInTheDocument();
    expect(within(mail).getByRole('button', { name: /Załącznik: faktura\.pdf/ })).toHaveTextContent('84 KB');
  });

  it('nic w makiecie nie nawiguje ani nie pobiera: brak <a>, href i download', () => {
    setup();
    const mail = screen.getByTestId('mail-client');
    expect(mail.querySelector('a')).toBeNull();
    expect(mail.querySelector('[href]')).toBeNull();
    expect(mail.querySelector('[download]')).toBeNull();
    for (const button of within(mail).getAllByRole('button')) expect(button).toHaveAttribute('type', 'button');
  });

  it('kliknięcie fragmentu (nadawca, temat, załącznik, cytat, link) zaznacza kryterium i synchronizuje checklistę', () => {
    setup();
    const mail = screen.getByTestId('mail-client');
    fireEvent.click(within(mail).getByRole('button', { name: /Bank Zaufany/ }));
    expect(checkbox(/Podejrzany adres nadawcy/)).toBeChecked();
    fireEvent.click(within(mail).getByRole('button', { name: /Pilne: potwierdź/ }));
    expect(checkbox(/Presja czasu/)).toBeChecked();
    fireEvent.click(within(mail).getByRole('button', { name: /Załącznik: faktura/ }));
    expect(checkbox(/załącznik/)).toBeChecked();
    fireEvent.click(within(mail).getByRole('button', { name: /Twoje konto zostanie zablokowane/ }));
    expect(checkbox(/Groźba/)).toBeChecked();
    fireEvent.click(within(mail).getByRole('button', { name: /Kliknij tutaj/ }));
    expect(checkbox(/obcej domeny/)).toBeChecked();

    // Ponowne kliknięcie odznacza.
    fireEvent.click(within(mail).getByRole('button', { name: /Bank Zaufany/ }));
    expect(checkbox(/Podejrzany adres nadawcy/)).not.toBeChecked();
    expect(within(mail).getByRole('button', { name: /Pilne: potwierdź/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('checklista działa jak alternatywa (klawiatura): zaznaczenie kryterium podświetla fragment; kryterium bez fragmentu tylko na liście', () => {
    setup();
    fireEvent.click(checkbox(/Podejrzany adres nadawcy/));
    expect(within(screen.getByTestId('mail-client')).getByRole('button', { name: /Bank Zaufany/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(list()).getByText(/ogólna oznaka, bez fragmentu w mailu/)).toBeInTheDocument();
    fireEvent.click(checkbox(/Ogólny, bezosobowy ton/));
    expect(checkbox(/Ogólny/)).toBeChecked();
  });

  it('wysyła { selected: [id kryteriów] } i nic więcej (ani poprawności, ani punktów)', () => {
    const onSubmit = setup();
    fireEvent.click(within(screen.getByTestId('mail-client')).getByRole('button', { name: /Bank Zaufany/ }));
    fireEvent.click(checkbox(/Ogólny/));
    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź odpowiedź' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ selected: ['k-sender', 'k-general'] });
  });
});

describe('EmailAnalysisBlock: link nigdy nie nawiguje, adres w pasku statusu', () => {
  const statusBar = () => screen.getByTestId('mail-status-bar');

  it('po najechaniu i fokusie pokazuje prawdziwy adres, po zjechaniu wraca podpowiedź', () => {
    setup();
    const link = within(screen.getByTestId('mail-client')).getByRole('button', { name: /Kliknij tutaj/ });
    expect(statusBar()).toHaveTextContent('Najedź na link');
    fireEvent.mouseEnter(link);
    expect(statusBar()).toHaveTextContent('https://bank-0.pl/login?u=1');
    fireEvent.mouseLeave(link);
    expect(statusBar()).toHaveTextContent('Najedź na link');
    fireEvent.focus(link);
    expect(statusBar()).toHaveTextContent('https://bank-0.pl/login?u=1');
  });

  it('kliknięcie przypina adres w pasku, zaznacza kryterium linku i nie zmienia adresu strony', () => {
    const before = window.location.href;
    setup();
    const link = within(screen.getByTestId('mail-client')).getByRole('button', { name: /Kliknij tutaj/ });
    const notPrevented = fireEvent.click(link); // true = zdarzenie nie zostało anulowane (nie ma domyślnej akcji do anulowania)
    expect(notPrevented).toBe(true);
    expect(statusBar()).toHaveTextContent('https://bank-0.pl/login?u=1');
    expect(window.location.href).toBe(before);
    expect(checkbox(/obcej domeny/)).toBeChecked();
  });

  it('link bez kryterium tylko pokazuje adres (nic nie zaznacza); adres jest też w tekście dla czytników ekranu', () => {
    setup();
    // Link spoza treści (tekst nie występuje w body) trafia pod treść jako osobny przycisk.
    const loose = within(screen.getByTestId('mail-client')).getByRole('button', { name: /Regulamin/ });
    fireEvent.click(loose);
    expect(statusBar()).toHaveTextContent('https://bank-0.pl/regulamin');
    expect(loose).toHaveTextContent('adres linku: https://bank-0.pl/regulamin');
    expect(within(list()).queryAllByRole('checkbox').filter((box) => (box as HTMLInputElement).checked)).toHaveLength(0);
  });

  it('załącznik: klik tylko zaznacza (brak pobierania)', () => {
    setup();
    const attachment = within(screen.getByTestId('mail-client')).getByRole('button', { name: /Załącznik: faktura/ });
    expect(attachment).not.toHaveAttribute('href');
    expect(attachment).not.toHaveAttribute('download');
    fireEvent.click(attachment);
    expect(attachment).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('EmailAnalysisBlock: wynik (tryb tylko do odczytu)', () => {
  const detail = {
    criteria: [
      { id: 'k-sender', correct: true, selected: true, explanation: 'Domena bank-0.pl to podróbka.' },
      { id: 'k-subject', correct: true, selected: false },
      { id: 'k-link', correct: false, selected: true },
      { id: 'k-att', correct: false, selected: false },
      { id: 'k-text', correct: true, selected: true },
      { id: 'k-general', correct: false, selected: false },
    ],
  };
  const result = { answer: { selected: ['k-sender', 'k-link', 'k-text'] }, detail, correct: false, points: 1 / 3 };

  it('oznacza trafione, fałszywe alarmy i przeoczone (tekst dla czytników), pokazuje wyjaśnienia i wynik procentowy, bez formularza', () => {
    setup({ result, onContinue: vi.fn() });
    const mail = screen.getByTestId('mail-client');
    expect(within(mail).getByRole('button', { name: /Bank Zaufany/ })).toHaveTextContent('(trafione)');
    expect(within(mail).getByRole('button', { name: /Kliknij tutaj/ })).toHaveTextContent('(fałszywy alarm)');
    expect(within(mail).getByRole('button', { name: /Pilne: potwierdź/ })).toHaveTextContent('(przeoczone)');
    expect(screen.getByText('Domena bank-0.pl to podróbka.')).toBeInTheDocument();
    expect(screen.getByText(/Wynik: 33%/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sprawdź odpowiedź' })).not.toBeInTheDocument();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.getAllByRole('checkbox').filter((box) => (box as HTMLInputElement).checked)).toHaveLength(3);
  });

  it('w wyniku fragmenty są zablokowane (klik niczego nie zmienia)', () => {
    setup({ result, onContinue: vi.fn() });
    const sender = within(screen.getByTestId('mail-client')).getByRole('button', { name: /Bank Zaufany/ });
    expect(sender).toBeDisabled();
  });

  it('gdy brak `answer` (starszy zapis), wybór gracza odtwarza się z detail.criteria[].selected', () => {
    setup({ result: { detail, correct: false, points: 1 / 3 }, onContinue: vi.fn() });
    expect(screen.getAllByRole('checkbox').filter((box) => (box as HTMLInputElement).checked)).toHaveLength(3);
  });

  it('link z pustym napisem pokazuje adres jako napis (nie znika)', () => {
    const empty: ContentBlock = { ...block, email: { ...block.email!, links: [{ id: 'l3', text: '', url: 'https://pusty.example/x' }] }, criteria: [] };
    render(
      <MascotReactionProvider resetKey="k">
        <EmailAnalysisBlock block={empty} onSubmit={vi.fn()} disabled={false} />
      </MascotReactionProvider>,
    );
    expect(within(screen.getByTestId('mail-client')).getByRole('button', { name: /pusty\.example/ })).toBeInTheDocument();
  });

  it('po zapisie: przycisk dalej z etykietą z powłoki; zła odpowiedź uruchamia reakcję "warning" maskotki', () => {
    const onContinue = vi.fn();
    setup({ result, onContinue, continueLabel: 'Zobacz podsumowanie' });
    fireEvent.click(screen.getByRole('button', { name: 'Zobacz podsumowanie' }));
    expect(onContinue).toHaveBeenCalled();
    expect(screen.getByTestId('reaction')).toHaveTextContent('warning');
  });

  it('podgląd (bez onContinue): bez przycisku dalej i bez reakcji maskotki', () => {
    setup({ result });
    expect(screen.queryByRole('button', { name: 'Dalej' })).not.toBeInTheDocument();
    expect(screen.getByTestId('reaction')).toHaveTextContent('');
  });

  it('poprawna odpowiedź nie wywołuje ostrzeżenia maskotki', () => {
    setup({ result: { ...result, correct: true, points: 1 }, onContinue: vi.fn() });
    expect(screen.getByTestId('reaction')).toHaveTextContent('');
    expect(screen.getByText(/wszystkie oznaki trafione/)).toBeInTheDocument();
  });

  it('reaction z treści (schemaVersion 4, reactions.result) ma pierwszeństwo nad ogólnym ostrzeżeniem', () => {
    setup({ result: { ...result, reaction: { pose: 'thinking', text: 'Prawie się udało.' } }, onContinue: vi.fn() });
    expect(screen.getByTestId('reaction')).toHaveTextContent('thinking');
  });
});

describe('bodySegments', () => {
  const criteria = [{ id: 'q', label: 'x', target: { kind: 'text' as const, quote: 'drugie zdanie' } }];

  it('dzieli treść na tekst, cytat i link (pierwsze wystąpienie), zachowując całość', () => {
    const { segments, loose } = bodySegments('Pierwsze. To drugie zdanie. Kliknij tutaj teraz.', criteria, [{ id: 'l', text: 'Kliknij tutaj', url: 'https://x.pl' }]);
    expect(segments.map((s) => s.text).join('')).toBe('Pierwsze. To drugie zdanie. Kliknij tutaj teraz.');
    expect(segments.find((s) => s.criterionId === 'q')?.text).toBe('drugie zdanie');
    expect(segments.find((s) => s.link)?.link?.url).toBe('https://x.pl');
    expect(loose).toEqual([]);
  });

  it('dwa linki z tym samym napisem (typowy phishing) dostają kolejne wystąpienia; żaden adres nie znika', () => {
    const { segments, loose } = bodySegments('Zaloguj się: Kliknij tutaj lub Kliknij tutaj.', [], [
      { id: 'a', text: 'Kliknij tutaj', url: 'https://prawdziwy.pl' },
      { id: 'b', text: 'Kliknij tutaj', url: 'https://oszust.example' },
    ]);
    const links = segments.filter((s) => s.link);
    expect(links.map((s) => s.link?.url)).toEqual(['https://prawdziwy.pl', 'https://oszust.example']);
    expect(segments.map((s) => s.text).join('')).toBe('Zaloguj się: Kliknij tutaj lub Kliknij tutaj.');
    expect(loose).toEqual([]);
  });

  it('link bez wolnego miejsca (napis występuje tylko raz, trzeci link) i link z pustym napisem trafiają pod treść (adres widoczny)', () => {
    const { segments, loose } = bodySegments('Kliknij tutaj.', [], [
      { id: 'a', text: 'Kliknij tutaj', url: 'https://a.pl' },
      { id: 'b', text: 'Kliknij tutaj', url: 'https://b.pl' },
      { id: 'c', text: '', url: 'https://c.pl' },
    ]);
    expect(segments.filter((s) => s.link).map((s) => s.link?.url)).toEqual(['https://a.pl']);
    expect(loose.map((l) => l.url)).toEqual(['https://b.pl', 'https://c.pl']);
  });

  it('cytat przecinający napis linku nie wypiera linku (link ma pierwszeństwo), a cytat dostaje inne wystąpienie albo odpada', () => {
    const criteria = [{ id: 'q', label: 'x', target: { kind: 'text' as const, quote: 'tutaj aby' } }];
    const { segments } = bodySegments('Kliknij tutaj aby wejść.', criteria, [{ id: 'l', text: 'Kliknij tutaj', url: 'https://x.pl' }]);
    expect(segments.find((s) => s.link)?.text).toBe('Kliknij tutaj');
    expect(segments.find((s) => s.criterionId === 'q')).toBeUndefined();
    expect(segments.map((s) => s.text).join('')).toBe('Kliknij tutaj aby wejść.');
  });

  it('link spoza treści jest "luźny"; fragment zachodzący na wcześniejszy jest pomijany (bez dublowania tekstu)', () => {
    const overlapping = [{ id: 'q', label: 'x', target: { kind: 'text' as const, quote: 'Kliknij' } }];
    const { segments, loose } = bodySegments('Kliknij tutaj', overlapping, [
      { id: 'l', text: 'Kliknij tutaj', url: 'https://x.pl' },
      { id: 'brak', text: 'nie ma', url: 'https://y.pl' },
    ]);
    expect(segments.map((s) => s.text).join('')).toBe('Kliknij tutaj');
    expect(loose.map((l) => l.id)).toEqual(['brak']);
  });
});
