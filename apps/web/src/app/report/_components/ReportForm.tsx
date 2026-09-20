'use client';

import { FormEvent, useState } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

const LIMITS = { sender: 320, subject: 300, body: 20_000, headers: 20_000, comment: 1000 } as const;

type Outcome = { isSimulation: boolean } | null;

const FIELD = 'mt-1 w-full rounded-btn border border-border bg-surface px-3 py-2 font-medium';

/**
 * Formularz zgłoszenia podejrzanej wiadomości. Wszystko jest czystym tekstem. Dopasowanie do symulacji i limity
 * (5 zgłoszeń/godz., 20/dobę) egzekwuje API; formularz tylko pokazuje wynik. Nie ujawniamy z góry, czy wiadomość
 * była symulacją - dowiaduje się tego dopiero po zgłoszeniu.
 */
export default function ReportForm() {
  const [sender, setSender] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [headers, setHeaders] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const canSubmit = sender.trim().length > 0 && subject.trim().length > 0 && !busy;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/threat-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender, subject, body, headers, comment }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(Array.isArray(data?.message) ? data.message.join(' ') : (data?.message ?? 'Nie udało się wysłać zgłoszenia.'));
        return;
      }
      setOutcome({ isSimulation: data?.isSimulation === true });
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setSender('');
    setSubject('');
    setBody('');
    setHeaders('');
    setComment('');
    setError(null);
    setOutcome(null);
  }

  if (outcome) {
    return (
      <Card>
        <div role="status" className="space-y-4 px-6 py-6">
          {outcome.isSimulation ? (
            <>
              <h2 className="text-xl font-extrabold">Brawo - to była symulacja!</h2>
              <p>Dobrze zrobiłeś/-aś, zgłaszając tę wiadomość. To był ćwiczebny e-mail phishingowy przygotowany przez Twoją organizację - dokładnie tak należy reagować na podejrzane wiadomości.</p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-extrabold">Dziękujemy za zgłoszenie</h2>
              <p>Zgłoszenie trafiło do osób odpowiedzialnych za bezpieczeństwo w Twojej firmie. Do czasu odpowiedzi nie klikaj w linki i nie otwieraj załączników z tej wiadomości.</p>
            </>
          )}
          <Button variant="secondary" onClick={reset}>
            Zgłoś kolejną wiadomość
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4 px-6 py-6 text-sm">
        <p className="rounded-btn bg-paper px-3 py-2 text-muted">
          Nie klikaj w linki z podejrzanej wiadomości. Skopiuj i wklej jej dane poniżej. Nie wklejaj haseł. Zgłoszenie zobaczą osoby odpowiedzialne za bezpieczeństwo w Twojej firmie.
        </p>

        {error && (
          <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 font-semibold text-danger">
            {error}
          </p>
        )}

        <label className="block font-bold">
          Nadawca (adres widoczny w programie pocztowym)
          <input value={sender} onChange={(e) => setSender(e.target.value)} maxLength={LIMITS.sender} required className={FIELD} placeholder="np. Kurier <kurier@example.com>" />
        </label>

        <label className="block font-bold">
          Temat wiadomości
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={LIMITS.subject} required className={FIELD} />
        </label>

        <label className="block font-bold">
          Treść wiadomości <span className="font-medium text-muted">(opcjonalnie)</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={LIMITS.body} rows={7} className={FIELD} />
        </label>

        <details className="rounded-btn border border-border px-3 py-2">
          <summary className="cursor-pointer font-bold">Nagłówki wiadomości (opcjonalnie, dla zaawansowanych)</summary>
          <label className="mt-2 block font-bold">
            Nagłówki
            <textarea value={headers} onChange={(e) => setHeaders(e.target.value)} maxLength={LIMITS.headers} rows={5} className={FIELD} />
          </label>
        </details>

        <label className="block font-bold">
          Komentarz <span className="font-medium text-muted">(opcjonalnie)</span>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={LIMITS.comment} rows={3} className={FIELD} />
        </label>

        <Button type="submit" disabled={!canSubmit}>
          {busy ? 'Wysyłanie...' : 'Zgłoś wiadomość'}
        </Button>
      </form>
    </Card>
  );
}
