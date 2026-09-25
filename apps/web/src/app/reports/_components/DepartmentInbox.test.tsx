import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DepartmentInbox from './DepartmentInbox';
import type { DepartmentInboxItem, DepartmentInbox as DepartmentInboxData } from '@/lib/threat-report-types';

const item = (over: Partial<DepartmentInboxItem> = {}): DepartmentInboxItem => ({
  id: 'r1',
  createdAt: '2027-01-01T10:00:00.000Z',
  status: 'NEW',
  senderDomain: 'obcadomena.example',
  isSimulation: false,
  ...over,
});

function data(items: DepartmentInboxItem[], over: Partial<DepartmentInboxData> = {}): DepartmentInboxData {
  return { items, total: items.length, page: 1, pageSize: 25, insufficientData: false, minGroupSize: 5, ...over };
}

function stubFetch(body: DepartmentInboxData) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('DepartmentInbox', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tabela przewija się poziomo wewnątrz karty; poniżej md ukrywa TYLKO "Symulacja" (nagłówek ORAZ komórka) - data zostaje zawsze widoczna jako jedyny element porządkujący wiersze z tej samej domeny', async () => {
    stubFetch(data([item()]));
    render(<DepartmentInbox />);

    const table = await screen.findByRole('table');
    expect(table.closest('.overflow-x-auto')).not.toBeNull();

    const symulacjaHeader = screen.getByRole('columnheader', { name: 'Symulacja' }).className.split(' ');
    expect(symulacjaHeader).toContain('hidden');
    expect(symulacjaHeader).toContain('md:table-cell');
    const symulacjaCell = screen.getByText('Nie').closest('td') as HTMLElement;
    const symulacjaCellClasses = symulacjaCell.className.split(' ');
    expect(symulacjaCellClasses).toContain('hidden');
    expect(symulacjaCellClasses).toContain('md:table-cell');

    for (const header of ['Zgłoszono', 'Domena nadawcy', 'Status']) {
      expect(screen.getByRole('columnheader', { name: header }).className.split(' ')).not.toContain('hidden');
    }
    const domainCell = screen.getByText('obcadomena.example').closest('td') as HTMLElement;
    expect(domainCell.className.split(' ')).not.toContain('hidden');
  });

  it('pasek stronicowania zawija się (mobile: numer strony + przyciski nie wychodzą poza ekran)', async () => {
    stubFetch(data([item()], { total: 60, pageSize: 25 }));
    render(<DepartmentInbox />);

    const nextButton = await screen.findByRole('button', { name: 'Następna' });
    await waitFor(() => expect(screen.getByText(/Strona 1 z 3/)).toBeInTheDocument());
    expect((nextButton.closest('div.justify-between') as HTMLElement).className).toMatch(/flex-wrap/);
  });
});
