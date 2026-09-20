'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { SearchInput } from '@/components/ui/Fields';
import { DEFAULT_TIMEZONE, formatDateTime, isoToZonedInput, zonedInputToIso } from '@/lib/datetime';
import type { Audience, AudienceType, PhishingConfig, PhishingTemplate } from '@/lib/phishing-types';
import type { DepartmentOption, UserListItem, UsersListResponse } from '@/lib/users-types';

const STEPS = ['Szablon', 'Odbiorcy', 'Okno wysyłki', 'Podgląd i uruchomienie'] as const;
const HOUR = 3_600_000;

// Podgląd treści: placeholder linku zastępujemy atrapą (nic nie jest klikalne w sandboxowanym iframe).
function previewDocument(template: PhishingTemplate): string {
  const body = template.bodyHtml.split('href="{{trackingLink}}"').join('href="#"');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;font-size:14px">${body}</body></html>`;
}

export default function CampaignWizard({
  templates,
  departments,
  config,
  timeZone = DEFAULT_TIMEZONE,
}: {
  templates: PhishingTemplate[];
  departments: DepartmentOption[];
  config: PhishingConfig;
  timeZone?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [audienceType, setAudienceType] = useState<AudienceType>('ALL');
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<UserListItem[]>([]);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<UserListItem[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  // Pola datetime-local to czas ścienny w strefie ORGANIZACJI (nie przeglądarki) - patrz lib/datetime.ts.
  const [windowStart, setWindowStart] = useState(() => isoToZonedInput(new Date(Date.now() + 5 * 60_000), timeZone));
  const [windowEnd, setWindowEnd] = useState(() => isoToZonedInput(new Date(Date.now() + 8 * HOUR), timeZone));
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = templates.find((item) => item.id === templateId) ?? null;
  const audience: Audience =
    audienceType === 'ALL'
      ? { type: 'ALL' }
      : audienceType === 'DEPARTMENTS'
        ? { type: 'DEPARTMENTS', departmentIds }
        : { type: 'USERS', userIds: selectedUsers.map((user) => user.id) };
  const audienceReady = audienceType === 'ALL' || (audienceType === 'DEPARTMENTS' ? departmentIds.length > 0 : selectedUsers.length > 0);

  // Wyszukiwanie pracowników (tryb "wskazane osoby"); tylko aktywni mogą być odbiorcami - API i tak to egzekwuje.
  useEffect(() => {
    if (audienceType !== 'USERS' || search.trim().length < 2) {
      setFound([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/users?search=${encodeURIComponent(search.trim())}&pageSize=20`);
        const data: UsersListResponse | null = await response.json().catch(() => null);
        if (!cancelled && response.ok && data) {
          setFound(data.items.filter((user) => user.status === 'ACTIVE'));
        }
      } catch {
        // wyszukiwanie jest wygodą - błąd sieci nie blokuje kreatora
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [audienceType, search]);

  // Liczba odbiorców z serwera (jedyne źródło prawdy: aktywni pracownicy tej organizacji z wybranego grona).
  const audienceKey = JSON.stringify(audience);
  useEffect(() => {
    if (step < 1 || !audienceReady) {
      setCount(null);
      return;
    }
    let cancelled = false;
    setCountError(null);
    (async () => {
      try {
        const response = await fetch('/api/phishing/campaigns/audience', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audience: JSON.parse(audienceKey) }),
        });
        const data = await response.json().catch(() => null);
        if (cancelled) return;
        if (response.ok) {
          setCount(data.count);
        } else {
          setCount(null);
          setCountError(data?.message ?? 'Nie udało się policzyć odbiorców.');
        }
      } catch {
        if (!cancelled) setCountError('Nie udało się połączyć z serwerem.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audienceKey, audienceReady, step]);

  const startDate = new Date(zonedInputToIso(windowStart, timeZone) ?? Number.NaN);
  const endDate = new Date(zonedInputToIso(windowEnd, timeZone) ?? Number.NaN);
  const windowValid =
    Number.isFinite(startDate.getTime()) &&
    Number.isFinite(endDate.getTime()) &&
    endDate.getTime() - startDate.getTime() >= 10 * 60_000 &&
    endDate.getTime() - startDate.getTime() <= 30 * 24 * HOUR &&
    endDate.getTime() > Date.now();
  const nameValid = name.trim().length >= 2;
  const canNext = [Boolean(template) && nameValid, audienceReady && count !== null && count > 0, windowValid, false][step];

  async function launch() {
    if (!template) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/phishing/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          templateId: template.id,
          audience,
          windowStart: startDate.toISOString(),
          windowEnd: endDate.toISOString(),
          acknowledged: true,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.message ?? 'Nie udało się uruchomić kampanii.');
        return;
      }
      router.push(`/dashboard/phishing/campaigns/${data.id}`);
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Kroki kreatora">
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? 'step' : undefined}
            className={`rounded-full px-3 py-1 font-bold ${index === step ? 'bg-accent text-white' : index < step ? 'bg-accent-soft text-accent-ink' : 'bg-surface text-muted'}`}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {!config.configured && (
        <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          Wysyłka symulacji nie jest skonfigurowana po stronie platformy ({config.reason ?? 'brak konfiguracji'}). Kampanii nie da się uruchomić.
        </p>
      )}
      {config.configured && !config.sendsRealMail && (
        <p className="rounded-btn bg-warning-soft px-3 py-2 text-sm font-semibold text-warning">
          Tryb testowy: wiadomości NIE są wysyłane (transport „{config.transport}”).
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <Card className="p-6">
        {step === 0 && (
          <div className="space-y-4">
            <label className="block text-sm font-bold">
              Nazwa kampanii
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                className="mt-1 h-10 w-full rounded-btn border border-border bg-surface px-3 font-medium"
              />
            </label>
            <fieldset className="space-y-2">
              <legend className="text-sm font-bold">Szablon wiadomości</legend>
              {templates.map((item) => (
                <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-btn border border-border p-3 text-sm hover:bg-paper">
                  <input type="radio" name="template" checked={templateId === item.id} onChange={() => setTemplateId(item.id)} className="mt-1" />
                  <span>
                    <span className="font-bold">{item.name}</span> <span className="text-xs text-muted">({item.scope === 'GLOBAL' ? 'globalny' : 'własny'})</span>
                    <br />
                    <span className="text-muted">
                      {item.senderName} &lt;{item.senderAddress ?? item.senderLocalPart}&gt; - {item.subject}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-bold">Kto dostanie wiadomość</legend>
              {(
                [
                  ['ALL', 'Wszyscy aktywni pracownicy organizacji'],
                  ['DEPARTMENTS', 'Wybrane działy'],
                  ['USERS', 'Wskazane osoby'],
                ] as [AudienceType, string][]
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="audience" checked={audienceType === value} onChange={() => setAudienceType(value)} />
                  {label}
                </label>
              ))}
            </fieldset>

            {audienceType === 'DEPARTMENTS' && (
              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="sr-only">Działy</legend>
                {departments.length === 0 && <p className="text-sm text-muted">Brak działów w organizacji.</p>}
                {departments.map((department) => (
                  <label key={department.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={departmentIds.includes(department.id)}
                      onChange={(event) =>
                        setDepartmentIds((ids) => (event.target.checked ? [...ids, department.id] : ids.filter((id) => id !== department.id)))
                      }
                    />
                    {department.name}
                  </label>
                ))}
              </fieldset>
            )}

            {audienceType === 'USERS' && (
              <div className="space-y-2">
                <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj pracownika (min. 2 znaki)" aria-label="Szukaj pracownika" />
                <ul className="space-y-1 text-sm">
                  {found
                    .filter((user) => !selectedUsers.some((selected) => selected.id === user.id))
                    .map((user) => (
                      <li key={user.id}>
                        <button type="button" className="text-accent-ink hover:underline" onClick={() => setSelectedUsers((users) => [...users, user])}>
                          Dodaj: {[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}
                        </button>
                      </li>
                    ))}
                </ul>
                {selectedUsers.length > 0 && (
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-muted">Wybrane ({selectedUsers.length})</div>
                    <ul className="mt-1 flex flex-wrap gap-2 text-sm">
                      {selectedUsers.map((user) => (
                        <li key={user.id} className="rounded-full bg-accent-soft px-3 py-1 text-accent-ink">
                          {[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}{' '}
                          <button type="button" aria-label={`Usuń ${user.email}`} onClick={() => setSelectedUsers((users) => users.filter((item) => item.id !== user.id))}>
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <p className="text-sm" aria-live="polite">
              {countError ? <span className="text-danger">{countError}</span> : count === null ? 'Wybierz odbiorców.' : `Odbiorców: ${count}`}
              {count === 0 && <span className="text-danger"> - brak aktywnych pracowników w wybranym gronie.</span>}
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Każdy odbiorca dostanie wiadomość w losowym momencie w tym oknie (okno: od 10 minut do 30 dni). Godziny w strefie organizacji: {timeZone}.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-bold">
                Początek okna
                <input type="datetime-local" value={windowStart} onChange={(event) => setWindowStart(event.target.value)} className="mt-1 h-10 w-full rounded-btn border border-border px-3 font-medium" />
              </label>
              <label className="block text-sm font-bold">
                Koniec okna
                <input type="datetime-local" value={windowEnd} onChange={(event) => setWindowEnd(event.target.value)} className="mt-1 h-10 w-full rounded-btn border border-border px-3 font-medium" />
              </label>
            </div>
            {!windowValid && <p className="text-sm text-danger">Okno musi trwać od 10 minut do 30 dni i kończyć się w przyszłości.</p>}
          </div>
        )}

        {step === 3 && template && (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-muted">Podgląd wiadomości</div>
              <p className="mt-1 text-sm">
                <span className="font-bold">{template.senderName}</span> &lt;{template.senderAddress ?? template.senderLocalPart}&gt;
                <br />
                Temat: {template.subject}
              </p>
              <iframe title="Podgląd wiadomości" sandbox="" srcDoc={previewDocument(template)} className="mt-2 h-64 w-full rounded-btn border border-border bg-white" />
            </div>
            <div className="rounded-card border border-warning bg-warning-soft p-4 text-sm">
              <p className="font-bold">Zanim uruchomisz kampanię, sprawdź:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  Wiadomość dostanie <strong>{count ?? '?'}</strong> {count === 1 ? 'osoba' : 'osób'}.
                </li>
                <li>
                  Wysyłka w oknie: <strong>{formatDateTime(startDate.toISOString(), timeZone)}</strong> - <strong>{formatDateTime(endDate.toISOString(), timeZone)}</strong>, w losowych momentach.
                </li>
                <li>
                  Nadawca: <strong>{template.senderAddress ?? template.senderLocalPart}</strong>
                  {config.landingHost ? <>, link prowadzi na stronę <strong>{config.landingHost}</strong>.</> : '.'}
                </li>
                <li>Kampanię można anulować (niewysłane wiadomości nie zostaną wysłane), ale wysłanych wiadomości nie da się cofnąć.</li>
              </ul>
              <label className="mt-3 flex items-start gap-2 font-semibold">
                <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1" />
                Rozumiem i uruchamiam kampanię symulacji phishingowej dla wskazanych osób.
              </label>
            </div>
          </div>
        )}
      </Card>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || submitting}>
          Wstecz
        </Button>
        {step < 3 ? (
          <Button onClick={() => setStep((current) => current + 1)} disabled={!canNext}>
            Dalej
          </Button>
        ) : (
          <Button onClick={launch} disabled={!acknowledged || !config.configured || submitting || count === 0 || count === null}>
            {submitting ? 'Uruchamianie...' : 'Uruchom kampanię'}
          </Button>
        )}
      </div>
    </div>
  );
}
