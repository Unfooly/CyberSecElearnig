'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { formatDateTime } from '@/lib/datetime';
import type { OrganizationOverview } from '@/lib/organization';

type Domain = NonNullable<OrganizationOverview['domain']>;

const FAILED_MESSAGE =
  'Nie znaleźliśmy jeszcze poprawnego rekordu. Sprawdź, czy wpis jest dokładnie taki jak powyżej - zmiany w DNS mogą być widoczne dopiero po kilkunastu minutach (czasem kilku godzinach).';

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // Timer "Skopiowano" nie może odpalić po odmontowaniu komponentu.
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Brak dostępu do schowka (np. HTTP, brak uprawnień) - wartość i tak da się zaznaczyć ręcznie.
      setFailed(true);
    }
  }

  return (
    <div>
      <dt className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-btn border border-border bg-paper px-3 py-2 text-[13px] font-semibold">
          {value}
        </code>
        <Button variant="secondary" size="sm" onClick={copy} aria-label={`Kopiuj: ${label}`} icon={copied ? <Check size={14} /> : <Copy size={14} />}>
          {copied ? 'Skopiowano' : 'Kopiuj'}
        </Button>
      </dd>
      {failed && <p className="mt-1 text-xs text-danger">Nie udało się skopiować - zaznacz wartość ręcznie.</p>}
    </div>
  );
}

export default function OnboardingClient({ organization }: { organization: OrganizationOverview }) {
  const router = useRouter();
  const [domain, setDomain] = useState<Domain | null>(organization.domain);
  const [isChecking, setIsChecking] = useState(false);
  // Po sukcesie przycisk zostaje zablokowany na czas przejścia do panelu (bez podwójnego kliknięcia).
  const [verified, setVerified] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  async function handleCheck() {
    setIsChecking(true);
    setMessage(null);
    try {
      const response = await fetch('/api/organization/domain/check', { method: 'POST' });
      if (response.ok) {
        setVerified(true);
        setMessage({ kind: 'success', text: 'Domena zweryfikowana! Przechodzimy do panelu...' });
        router.push('/dashboard');
        router.refresh();
        return;
      }
      if (response.status === 429) {
        setMessage({ kind: 'error', text: 'Sprawdzasz zbyt często. Odczekaj chwilę (kilka sekund) i spróbuj ponownie.' });
        return;
      }
      if (response.status === 401) {
        router.push('/login');
        return;
      }
      // Jeden komunikat dla każdej porażki weryfikacji (API celowo nie ujawnia przyczyny).
      setMessage({ kind: 'error', text: response.status === 400 ? FAILED_MESSAGE : 'Nie udało się sprawdzić domeny. Spróbuj ponownie później.' });
      setDomain((current) => (current ? { ...current, lastCheckedAt: new Date().toISOString() } : current));
    } catch {
      setMessage({ kind: 'error', text: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' });
    } finally {
      setIsChecking(false);
    }
  }

  if (!domain) {
    return (
      <Card className="p-6">
        <p role="alert" className="text-sm text-danger">
          Nie znaleźliśmy domeny do weryfikacji dla tej organizacji. Skontaktuj się z nami.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Zweryfikuj domenę firmy</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Organizacja <strong className="text-ink">{organization.name}</strong> odblokuje się po potwierdzeniu, że
          zarządzasz domeną <strong className="text-ink">{domain.name}</strong>. Do tego czasu dostępne są tylko ten
          ekran i ustawienia.
        </p>
      </div>

      <Card className="p-6">
        <h2 className="mb-1 text-lg font-bold">1. Dodaj rekord TXT w DNS</h2>
        <p className="mb-4 text-sm text-muted">
          Wejdź do panelu DNS domeny (u rejestratora lub dostawcy hostingu) i dodaj poniższy rekord.
        </p>
        <dl className="space-y-4">
          <CopyValue label="Typ" value={domain.txtRecord.type} />
          <CopyValue label="Nazwa (host)" value={domain.txtRecord.host} />
          <CopyValue label="Wartość" value={domain.txtRecord.value} />
        </dl>
        <p className="mt-4 text-xs text-muted">
          Niektóre panele DNS same dopisują domenę do nazwy - wtedy wpisz samo <code>_unfooly-verify</code>.
        </p>
      </Card>

      <Card className="p-6">
        <h2 className="mb-1 text-lg font-bold">2. Sprawdź weryfikację</h2>
        <p className="mb-4 text-sm text-muted">
          Status:{' '}
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-bold text-warning">
            Oczekuje na weryfikację
          </span>
          {domain.lastCheckedAt && (
            <span className="ml-2">
              Ostatnie sprawdzenie: {formatDateTime(domain.lastCheckedAt)}
            </span>
          )}
        </p>
        <Button onClick={handleCheck} disabled={isChecking || verified}>
          {isChecking ? 'Sprawdzanie...' : 'Sprawdź teraz'}
        </Button>
        {message && (
          <p
            role={message.kind === 'error' ? 'alert' : 'status'}
            className={`mt-4 rounded-btn px-3 py-2 text-sm font-semibold ${
              message.kind === 'error' ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'
            }`}
          >
            {message.text}
          </p>
        )}
        <p className="mt-4 text-xs text-muted">
          Organizacje, które nie zweryfikują domeny, są usuwane wraz z danymi po 14 dniach od rejestracji (przypomnienie
          wyślemy e-mailem po 7 dniach).
        </p>
      </Card>
    </div>
  );
}
