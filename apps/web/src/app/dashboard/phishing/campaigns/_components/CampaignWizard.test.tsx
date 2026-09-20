import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CampaignWizard from './CampaignWizard';
import type { PhishingConfig, PhishingTemplate } from '@/lib/phishing-types';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));

const template: PhishingTemplate = {
  id: 't1', scope: 'GLOBAL', key: 'kurier', name: 'Przesyłka kurierska', subject: 'Twoja paczka', bodyHtml: '<p><a href="{{trackingLink}}">Odbierz</a></p>',
  lessonHtml: '<p>l</p>', senderName: 'Szybka Paczka', senderLocalPart: 'powiadomienia', senderAddress: 'powiadomienia@symulacje.example.test',
  sourceTemplateId: null, updatedAt: '2027-01-01T00:00:00.000Z',
};
const departments = [{ id: 'd1', name: 'Sprzedaż' }, { id: 'd2', name: 'IT' }];
const config: PhishingConfig = { transport: 'mailersend', configured: true, reason: null, senderDomain: 'symulacje.example.test', landingHost: 'landing.example.test', sendsRealMail: true };

const fetchMock = vi.fn();
function okJson(data: unknown) {
  return { ok: true, json: async () => data };
}

async function goToLaunchStep() {
  fireEvent.change(screen.getByLabelText('Nazwa kampanii'), { target: { value: 'Jesień' } });
  fireEvent.click(screen.getByRole('radio', { name: /Przesyłka kurierska/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Dalej' }));
  await waitFor(() => expect(screen.getByText('Odbiorców: 5')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Dalej' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dalej' }));
}

describe('CampaignWizard', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => (url === '/api/phishing/campaigns/audience' ? okJson({ count: 5, limit: 5000 }) : okJson({ id: 'nowa' })));
    vi.stubGlobal('fetch', fetchMock);
    pushMock.mockReset();
  });

  it('krok 1: bez nazwy i szablonu nie da się przejść dalej', () => {
    render(<CampaignWizard templates={[template]} departments={departments} config={config} />);

    expect(screen.getByRole('button', { name: 'Dalej' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Nazwa kampanii'), { target: { value: 'Jesień' } });
    expect(screen.getByRole('button', { name: 'Dalej' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Przesyłka kurierska/ }));
    expect(screen.getByRole('button', { name: 'Dalej' })).toBeEnabled();
  });

  it('krok 2: liczba odbiorców pochodzi z serwera; tryb działów wymaga wyboru; 0 odbiorców blokuje dalej', async () => {
    render(<CampaignWizard templates={[template]} departments={departments} config={config} />);
    fireEvent.change(screen.getByLabelText('Nazwa kampanii'), { target: { value: 'Jesień' } });
    fireEvent.click(screen.getByRole('radio', { name: /Przesyłka kurierska/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dalej' }));

    await waitFor(() => expect(screen.getByText('Odbiorców: 5')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: 'Wybrane działy' }));
    expect(screen.getByRole('button', { name: 'Dalej' })).toBeDisabled();
    fetchMock.mockImplementation(async () => okJson({ count: 0, limit: 5000 }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'IT' }));
    await waitFor(() => expect(screen.getByText(/brak aktywnych pracowników/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Dalej' })).toBeDisabled();
    const audienceCall = fetchMock.mock.calls.filter(([url]) => url === '/api/phishing/campaigns/audience').at(-1);
    expect(JSON.parse(audienceCall?.[1].body)).toEqual({ audience: { type: 'DEPARTMENTS', departmentIds: ['d2'] } });
  });

  it('krok 4: podgląd w sandboxowanym iframe, ostrzeżenie (odbiorcy, okno, nadawca, strona) i uruchomienie dopiero po potwierdzeniu', async () => {
    render(<CampaignWizard templates={[template]} departments={departments} config={config} />);
    await goToLaunchStep();

    const iframe = screen.getByTitle('Podgląd wiadomości');
    expect(iframe).toHaveAttribute('sandbox', '');
    expect(iframe.getAttribute('srcdoc')).toContain('href="#"');
    expect(iframe.getAttribute('srcdoc')).not.toContain('{{trackingLink}}');
    expect(screen.getByText(/powiadomienia@symulacje.example.test/, { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('landing.example.test')).toBeInTheDocument();
    const launch = screen.getByRole('button', { name: 'Uruchom kampanię' });
    expect(launch).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /Rozumiem i uruchamiam/ }));
    fireEvent.click(launch);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard/phishing/campaigns/nowa'));
    const post = fetchMock.mock.calls.find(([url, init]) => url === '/api/phishing/campaigns' && init?.method === 'POST');
    const body = JSON.parse(post?.[1].body);
    expect(body).toMatchObject({ name: 'Jesień', templateId: 't1', audience: { type: 'ALL' }, acknowledged: true });
    expect(new Date(body.windowEnd).getTime()).toBeGreaterThan(new Date(body.windowStart).getTime());
  });

  it('błąd API przy uruchomieniu jest pokazany i kreator zostaje', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/phishing/campaigns/audience' ? okJson({ count: 5, limit: 5000 }) : { ok: false, json: async () => ({ message: 'Wysyłka symulacji nie jest skonfigurowana.' }) },
    );
    render(<CampaignWizard templates={[template]} departments={departments} config={config} />);
    await goToLaunchStep();

    fireEvent.click(screen.getByRole('checkbox', { name: /Rozumiem i uruchamiam/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Uruchom kampanię' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('nie jest skonfigurowana');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('transport nieskonfigurowany: ostrzeżenie i zablokowane uruchomienie; tryb testowy (log) jest oznaczony', async () => {
    const { unmount } = render(<CampaignWizard templates={[template]} departments={departments} config={{ ...config, transport: 'none', configured: false, reason: 'TRANSPORT_NOT_SELECTED', sendsRealMail: false }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('nie jest skonfigurowana');
    await goToLaunchStep();
    fireEvent.click(screen.getByRole('checkbox', { name: /Rozumiem i uruchamiam/ }));
    expect(screen.getByRole('button', { name: 'Uruchom kampanię' })).toBeDisabled();
    unmount();

    render(<CampaignWizard templates={[template]} departments={departments} config={{ ...config, transport: 'log', sendsRealMail: false }} />);
    expect(screen.getByText(/Tryb testowy: wiadomości NIE są wysyłane/)).toBeInTheDocument();
  });

  it('okno kampanii = czas ścienny w strefie ORGANIZACJI: 10:00 w Europe/Warsaw to 08:00 UTC także w przeglądarce w Los Angeles', async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      render(<CampaignWizard templates={[template]} departments={departments} config={config} />);
      fireEvent.change(screen.getByLabelText('Nazwa kampanii'), { target: { value: 'Jesień' } });
      fireEvent.click(screen.getByRole('radio', { name: /Przesyłka kurierska/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Dalej' }));
      await waitFor(() => expect(screen.getByText('Odbiorców: 5')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Dalej' }));
      fireEvent.change(screen.getByLabelText('Początek okna'), { target: { value: '2031-09-20T10:00' } });
      fireEvent.change(screen.getByLabelText('Koniec okna'), { target: { value: '2031-09-20T12:30' } });
      expect(screen.getByText(/Godziny w strefie organizacji: Europe\/Warsaw/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Dalej' }));
      expect(screen.getByText(/20 wrz 2031, 10:00/)).toBeInTheDocument(); // podsumowanie w tej samej strefie co wejście
      fireEvent.click(screen.getByRole('checkbox', { name: /Rozumiem i uruchamiam/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Uruchom kampanię' }));

      await waitFor(() => expect(pushMock).toHaveBeenCalled());
      const post = fetchMock.mock.calls.find(([url, init]) => url === '/api/phishing/campaigns' && init?.method === 'POST');
      expect(JSON.parse(post?.[1].body)).toMatchObject({ windowStart: '2031-09-20T08:00:00.000Z', windowEnd: '2031-09-20T10:30:00.000Z' });
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it('krok 3: okno krótsze niż 10 minut blokuje dalej', async () => {
    render(<CampaignWizard templates={[template]} departments={departments} config={config} />);
    fireEvent.change(screen.getByLabelText('Nazwa kampanii'), { target: { value: 'Jesień' } });
    fireEvent.click(screen.getByRole('radio', { name: /Przesyłka kurierska/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dalej' }));
    await waitFor(() => expect(screen.getByText('Odbiorców: 5')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Dalej' }));

    const start = screen.getByLabelText('Początek okna') as HTMLInputElement;
    fireEvent.change(screen.getByLabelText('Koniec okna'), { target: { value: start.value } });

    expect(screen.getByRole('button', { name: 'Dalej' })).toBeDisabled();
    expect(screen.getByText(/od 10 minut do 30 dni/, { selector: 'p.text-danger' })).toBeInTheDocument();
  });
});
