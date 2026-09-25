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

  it('tabela przewija się poziomo wewnątrz karty; poniżej md ukrywa "Zgłoszono" i "Symulacja", zostawia domenę i status', async () => {
    stubFetch(data([item()]));
    render(<DepartmentInbox />);

    const table = await screen.findByRole('table');
    expect(table.closest('.overflow-x-auto')).not.toBeNull();
    for (const header of ['Zgłoszono', 'Symulacja']) {
      const className = screen.getByRole('columnheader', { name: header }).className;
      expect(className).toMatch(/\bhidden\b/);
      expect(className).toMatch(/\bmd:table-cell\b/);
    }
    expect(screen.getByRole('columnheader', { name: 'Domena nadawcy' }).className).not.toMatch(/hidden/);
    expect(screen.getByRole('columnheader', { name: 'Status' }).className).not.toMatch(/hidden/);
  });

  it('pasek stronicowania zawija się (mobile: numer strony + przyciski nie wychodzą poza ekran)', async () => {
    stubFetch(data([item()], { total: 60, pageSize: 25 }));
    render(<DepartmentInbox />);

    const nextButton = await screen.findByRole('button', { name: 'Następna' });
    await waitFor(() => expect(screen.getByText(/Strona 1 z 3/)).toBeInTheDocument());
    expect((nextButton.closest('div.justify-between') as HTMLElement).className).toMatch(/flex-wrap/);
  });
});
