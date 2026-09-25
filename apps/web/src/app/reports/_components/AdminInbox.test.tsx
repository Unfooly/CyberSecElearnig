import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AdminInbox from './AdminInbox';
import type { AdminInboxItem, Page } from '@/lib/threat-report-types';

const item = (over: Partial<AdminInboxItem> = {}): AdminInboxItem => ({
  id: 'r1',
  createdAt: '2027-01-01T10:00:00.000Z',
  status: 'NEW',
  subject: 'Podejrzana faktura',
  senderText: 'ksiegowosc@obcadomena.example',
  senderDomain: 'obcadomena.example',
  hasContent: true,
  ...over,
});

function page(items: AdminInboxItem[], over: Partial<Page<AdminInboxItem>> = {}): Page<AdminInboxItem> {
  return { items, total: items.length, page: 1, pageSize: 25, ...over };
}

function stubFetch(body: Page<AdminInboxItem>) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('AdminInbox', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tabela przewija się poziomo wewnątrz karty; poniżej md ukrywa "Zgłoszono", zostawia temat i status', async () => {
    stubFetch(page([item()]));
    render(<AdminInbox />);

    const table = await screen.findByRole('table');
    expect(table.closest('.overflow-x-auto')).not.toBeNull();
    const zgloszono = screen.getByRole('columnheader', { name: 'Zgłoszono' }).className;
    expect(zgloszono).toMatch(/\bhidden\b/);
    expect(zgloszono).toMatch(/\bmd:table-cell\b/);
    expect(screen.getByRole('columnheader', { name: 'Temat i nadawca' }).className).not.toMatch(/hidden/);
    expect(screen.getByRole('columnheader', { name: 'Status' }).className).not.toMatch(/hidden/);
  });

  it('pasek stronicowania zawija się (mobile: numer strony + przyciski nie wychodzą poza ekran)', async () => {
    stubFetch(page([item()], { total: 60, pageSize: 25 }));
    render(<AdminInbox />);

    const nextButton = await screen.findByRole('button', { name: 'Następna' });
    await waitFor(() => expect(screen.getByText(/Strona 1 z 3/)).toBeInTheDocument());
    expect((nextButton.closest('div.justify-between') as HTMLElement).className).toMatch(/flex-wrap/);
  });
});
