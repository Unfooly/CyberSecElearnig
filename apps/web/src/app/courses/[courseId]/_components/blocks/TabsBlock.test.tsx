import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ContentBlock } from '@/lib/courses-types';
import TabsBlock from './TabsBlock';

// Teczka na telefonie (uwaga właściciela 2026-11-22): przekładki w kolumnie (każda to pełny wiersz), pieczątka w przepływie nad nimi -
// nie zasłania pierwszej przekładki. jsdom nie liczy układu - test sprawdza klasy (wygląd: zrzuty z podglądu w opisie PR).

const folder: ContentBlock = {
  type: 'TABS',
  id: 'raport',
  title: 'Raport końcowy',
  look: 'folder',
  stamp: 'Sprawa zamknięta',
  tabs: [
    { id: 'etap-1', title: 'Etap 1: E-mail', content: 'Mail.' },
    { id: 'etap-2', title: 'Etap 2: Rozmowa', content: 'Rozmowa.' },
    { id: 'etap-3', title: 'Etap 3: Link', content: 'Link.' },
  ],
};

const renderFolder = () => render(<TabsBlock block={folder} onSubmit={() => {}} onReady={() => {}} />);

describe('TabsBlock - teczka na telefonie', () => {
  it('przekładki w kolumnie na telefonie, w rzędzie od sm; pieczątka absolutnie tylko od sm (na telefonie nad kolumną)', () => {
    renderFolder();
    const list = screen.getByRole('tablist');
    expect(list).toHaveClass('max-sm:flex-col', 'sm:flex-wrap', 'sm:pr-44');
    for (const tab of screen.getAllByRole('tab')) expect(tab).toHaveClass('max-sm:w-full');
    const stamp = screen.getByTestId('folder-stamp');
    expect(stamp).toHaveTextContent('Sprawa zamknięta');
    expect(stamp).toHaveClass('sm:absolute');
    expect(stamp).not.toHaveClass('absolute');
    // Pieczątka przed listą przekładek (w przepływie dokumentu - nad kolumną).
    expect(stamp.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('kliknięcie wiersza przełącza kartkę; strzałki góra/dół jak lewo/prawo (kolumna na telefonie)', () => {
    renderFolder();
    fireEvent.click(screen.getByRole('tab', { name: 'Etap 2: Rozmowa' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Rozmowa.');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Etap 2: Rozmowa' }), { key: 'ArrowDown' });
    expect(screen.getByRole('tab', { name: 'Etap 3: Link' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Etap 3: Link' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Etap 3: Link' }), { key: 'ArrowDown' });
    expect(screen.getByRole('tab', { name: /^Etap 1: E-mail/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: /^Etap 1: E-mail/ }), { key: 'ArrowUp' });
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Link.');
  });
});
