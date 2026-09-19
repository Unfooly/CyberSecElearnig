import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TemplatesList from './TemplatesList';
import type { PhishingTemplate } from '@/lib/phishing-types';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

const base: PhishingTemplate = {
  id: 'g1', scope: 'GLOBAL', key: 'kurier', name: 'Przesyłka kurierska', subject: 'Twoja paczka', bodyHtml: '<a href="{{trackingLink}}">x</a>',
  lessonHtml: '<p>l</p>', senderName: 'Szybka Paczka', senderLocalPart: 'powiadomienia', senderAddress: 'powiadomienia@symulacje.example.test',
  sourceTemplateId: null, updatedAt: '2027-01-01T00:00:00.000Z',
};
const own: PhishingTemplate = { ...base, id: 'o1', scope: 'ORGANIZATION', key: null, name: 'Moja kopia' };

describe('TemplatesList', () => {
  it('pokazuje typ (Globalny/Własny), nadawcę z pełnym adresem i odpowiednie akcje', () => {
    render(<TemplatesList initialTemplates={[base, own]} />);

    expect(screen.getByText('Globalny')).toBeInTheDocument();
    expect(screen.getByText('Własny')).toBeInTheDocument();
    expect(screen.getAllByText('powiadomienia@symulacje.example.test')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Podgląd' })).toHaveAttribute('href', '/dashboard/phishing/templates/g1');
    expect(screen.getByRole('link', { name: 'Edytuj' })).toHaveAttribute('href', '/dashboard/phishing/templates/o1');
  });

  it('Klonuj: POST i przejście do edytora nowego szablonu', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'nowy' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<TemplatesList initialTemplates={[base]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Klonuj' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard/phishing/templates/nowy'));
    expect(fetchMock).toHaveBeenCalledWith('/api/phishing/templates/g1/clone', expect.objectContaining({ method: 'POST' }));
  });

  it('błąd klonowania (np. limit) jest pokazany', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Osiągnięto limit.' }) }));
    render(<TemplatesList initialTemplates={[base]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Klonuj' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Osiągnięto limit.');
  });
});
