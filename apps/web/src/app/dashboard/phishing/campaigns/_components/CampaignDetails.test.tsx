import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CampaignDetails from './CampaignDetails';
import CampaignsList from './CampaignsList';
import type { Campaign } from '@/lib/phishing-types';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }));

const campaign: Campaign = {
  id: 'c1',
  name: 'Kampania jesienna',
  status: 'RUNNING',
  audienceType: 'ALL',
  templateName: 'Przesyłka kurierska',
  subject: 'Paczka',
  senderName: 'Szybka Paczka',
  senderAddress: 'powiadomienia@symulacje.example.test',
  windowStart: '2027-01-01T08:00:00.000Z',
  windowEnd: '2027-01-01T16:00:00.000Z',
  createdAt: '2027-01-01T07:00:00.000Z',
  cancelledAt: null,
  completedAt: null,
  createdByEmail: 'admin@firma.pl',
  counts: { total: 10, pending: 4, sent: 3, failed: 1, uncertain: 2 },
  failures: [
    { code: 'TIMEOUT_UNKNOWN', count: 2, uncertain: true },
    { code: 'HTTP_422', count: 1, uncertain: false },
  ],
};

describe('CampaignDetails', () => {
  it('pokazuje liczniki i rozdziela "niepewne" od "nieudanych" z opisem przyczyny', () => {
    render(<CampaignDetails campaign={campaign} />);

    const stat = (label: string) => screen.getByText(label, { selector: 'div.uppercase' }).parentElement as HTMLElement;
    expect(stat('Niepewne')).toHaveTextContent('2');
    expect(stat('Nieudane')).toHaveTextContent('1');
    expect(stat('Wysłano')).toHaveTextContent('3');
    const timeoutRow = screen.getByText(/Przekroczony czas/, { selector: 'td' }).closest('tr') as HTMLElement;
    expect(timeoutRow).toHaveTextContent('Niepewne');
    expect(timeoutRow).toHaveTextContent('dostawca mógł wysłać wiadomość');
    const rejectedRow = screen.getByText('Odrzucone przez dostawcę (HTTP_422)').closest('tr') as HTMLElement;
    expect(rejectedRow).toHaveTextContent('Nieudane');
    expect(rejectedRow).not.toHaveTextContent('Niepewne');
  });

  it('anulowanie wymaga potwierdzenia: POST dopiero po "Tak", potem odświeżenie', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<CampaignDetails campaign={campaign} />);

    fireEvent.click(screen.getByRole('button', { name: 'Anuluj kampanię' }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tak, anuluj kampanię' }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/phishing/campaigns/c1/cancel', expect.objectContaining({ method: 'POST' }));
  });

  it('błąd anulowania jest pokazany, a zakończona kampania nie ma przycisku anulowania', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Kampania jest już zakończona lub anulowana.' }) }));
    const { unmount } = render(<CampaignDetails campaign={campaign} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj kampanię' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tak, anuluj kampanię' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('już zakończona');
    unmount();

    render(<CampaignDetails campaign={{ ...campaign, status: 'COMPLETED' }} />);
    expect(screen.queryByRole('button', { name: 'Anuluj kampanię' })).not.toBeInTheDocument();
  });
});

describe('CampaignsList', () => {
  it('pusta lista: zachęta do utworzenia pierwszej kampanii', () => {
    render(<CampaignsList campaigns={[]} />);

    expect(screen.getByText(/Nie masz jeszcze żadnej kampanii/)).toBeInTheDocument();
  });

  it('wiersz: nazwa jako link do szczegółów, status i liczniki', () => {
    render(<CampaignsList campaigns={[campaign]} />);

    expect(screen.getByRole('link', { name: 'Kampania jesienna' })).toHaveAttribute('href', '/dashboard/phishing/campaigns/c1');
    expect(screen.getByText('W trakcie')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });
});
