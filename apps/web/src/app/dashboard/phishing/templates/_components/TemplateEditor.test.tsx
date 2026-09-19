import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TemplateEditor from './TemplateEditor';
import type { PhishingTemplate, PhishingTemplateEdit } from '@/lib/phishing-types';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));

const OWN: PhishingTemplate = {
  id: 'tpl_1',
  scope: 'ORGANIZATION',
  key: null,
  name: 'Moja faktura',
  subject: 'Faktura do zapłaty',
  bodyHtml: '<p>Hej</p><a href="{{trackingLink}}">Kliknij</a>',
  lessonHtml: '<p>Lekcja</p>',
  senderName: 'Rozliczenia',
  senderLocalPart: 'rozliczenia',
  senderAddress: 'rozliczenia@symulacje.example.test',
  sourceTemplateId: 'phishtpl_faktura',
  updatedAt: '2027-01-01T00:00:00.000Z',
};
const GLOBAL: PhishingTemplate = { ...OWN, id: 'phishtpl_faktura', scope: 'GLOBAL', key: 'faktura', senderAddress: 'rozliczenia@symulacje.example.test' };
const EDITS: PhishingTemplateEdit[] = [
  { id: 'e1', templateId: 'tpl_1', templateName: 'Moja faktura', action: 'UPDATED', changedFields: ['subject'], actorEmail: 'admin@firma.pl', createdAt: '2027-01-02T10:00:00.000Z' },
];

const okPreview = { ok: true, status: 200, json: async () => ({ bodyHtml: '<p>Hej</p>', lessonHtml: '<p>Lekcja</p>', hasTrackingLink: true }) };

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('TemplateEditor', () => {
  beforeEach(() => {
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  it('domena nadawcy jest tylko do odczytu (sufiks @domena), edytowalna jest część lokalna', () => {
    mockFetch(() => okPreview);
    render(<TemplateEditor template={OWN} edits={EDITS} />);

    expect(screen.getByText('@symulacje.example.test')).toBeInTheDocument();
    expect(screen.getByLabelText('Adres nadawcy')).toHaveValue('rozliczenia');
    expect(screen.getByText(/Domena nadawcy jest zawsze nasza/)).toBeInTheDocument();
  });

  it('szablon globalny: pola zablokowane, tylko "Sklonuj, aby edytować" (bez Zapisz/Usuń i historii)', async () => {
    const fetchMock = mockFetch((url) => (url.endsWith('/clone') ? { ok: true, status: 201, json: async () => ({ id: 'nowy' }) } : okPreview));
    render(<TemplateEditor template={GLOBAL} edits={[]} />);

    expect(screen.getByLabelText('Temat')).toBeDisabled();
    expect(screen.getByLabelText('Treść maila')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Zapisz' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usuń szablon' })).not.toBeInTheDocument();
    expect(screen.queryByText('Historia zmian')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sklonuj, aby edytować' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard/phishing/templates/nowy'));
    expect(fetchMock).toHaveBeenCalledWith('/api/phishing/templates/phishtpl_faktura/clone', expect.objectContaining({ method: 'POST' }));
  });

  it('podgląd pochodzi z API (sanityzacja) i jest renderowany w piaskownicy iframe bez skryptów', async () => {
    mockFetch(() => okPreview);
    render(<TemplateEditor template={OWN} edits={[]} />);

    const frame = await screen.findByTitle('Podgląd treści maila');
    await waitFor(() => expect(frame.getAttribute('srcdoc')).toContain('<p>Hej</p>'));
    expect(frame).toHaveAttribute('sandbox', '');
  });

  it('podgląd wywołuje API z aktualną treścią po edycji (z opóźnieniem) i ostrzega o braku {{trackingLink}}', async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url.endsWith('/preview')) {
        const body = JSON.parse(String(init?.body));
        return { ok: true, status: 200, json: async () => ({ bodyHtml: body.bodyHtml, lessonHtml: body.lessonHtml, hasTrackingLink: body.bodyHtml.includes('trackingLink') }) };
      }
      return okPreview;
    });
    render(<TemplateEditor template={OWN} edits={[]} />);

    fireEvent.change(screen.getByLabelText('Treść maila'), { target: { value: '<p>bez linku</p>' } });

    expect(await screen.findByText(/nie zawiera linku/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => String(init?.body).includes('bez linku'))).toBe(true);
  });

  it('Zapisz: PATCH z polami formularza, komunikat sukcesu i odświeżenie', async () => {
    const fetchMock = mockFetch((url, init) => (init?.method === 'PATCH' ? { ok: true, status: 200, json: async () => ({}) } : okPreview));
    render(<TemplateEditor template={OWN} edits={[]} />);

    fireEvent.change(screen.getByLabelText('Temat'), { target: { value: 'Nowy temat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    expect(await screen.findByText(/Zapisano/)).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(patch[0]).toBe('/api/phishing/templates/tpl_1');
    expect(JSON.parse(String(patch[1]?.body))).toMatchObject({ subject: 'Nowy temat', senderLocalPart: 'rozliczenia' });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('błąd zapisu z API (np. brak linku) jest pokazany użytkownikowi', async () => {
    mockFetch((url, init) =>
      init?.method === 'PATCH' ? { ok: false, status: 400, json: async () => ({ message: 'Treść maila musi zawierać link.' }) } : okPreview,
    );
    render(<TemplateEditor template={OWN} edits={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Treść maila musi zawierać link.');
  });

  it('Usuń: wymaga potwierdzenia; po potwierdzeniu DELETE i powrót do listy', async () => {
    const fetchMock = mockFetch((url, init) => (init?.method === 'DELETE' ? { ok: true, status: 204, json: async () => null } : okPreview));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<TemplateEditor template={OWN} edits={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Usuń szablon' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Usuń szablon' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard/phishing/templates'));
    confirmSpy.mockRestore();
  });

  it('historia zmian pokazuje kto, kiedy i jakie pola', () => {
    mockFetch(() => okPreview);
    render(<TemplateEditor template={OWN} edits={EDITS} />);

    expect(screen.getByText(/admin@firma.pl/)).toBeInTheDocument();
    expect(screen.getByText(/\(subject\)/)).toBeInTheDocument();
  });
});
