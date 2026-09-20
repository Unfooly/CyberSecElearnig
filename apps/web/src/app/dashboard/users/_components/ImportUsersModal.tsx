'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import Button from '@/components/ui/Button';
import { formatDateTime } from '@/lib/datetime';
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, IMPORT_TEMPLATE, IMPORT_TEMPLATE_FILENAME } from '@/lib/import-template';
import type { ImportApiError, ImportPreview, ImportSummary } from '@/lib/import-types';

const POLL_MS = 10_000;
const SETTINGS_HREF = '/dashboard/settings';

function downloadTemplate() {
  const blob = new Blob([IMPORT_TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = IMPORT_TEMPLATE_FILENAME;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Komunikat błędu API: tekst, lista walidacji (ValidationPipe) albo domyślny. */
function messageOf(data: ImportApiError | null, fallback: string): string {
  if (Array.isArray(data?.message)) return data.message.join(' ');
  return typeof data?.message === 'string' && data.message ? data.message : fallback;
}

type Step = 'loading' | 'select' | 'preview' | 'progress';

/**
 * Kreator importu pracowników z CSV (dwuetapowy): (1) wybór pliku, (2) podgląd z walidacją per wiersz, stanem licencji i listą
 * błędów, (3) potwierdzenie (tworzy konta), (4) postęp kolejki zaproszeń z tempem: "wysłano X z Y, reszta jutro" i szacowana data
 * zakończenia; raport CSV do pobrania. Wszystko poza wyborem pliku dzieje się po stronie API - UI tylko odzwierciedla jego stan
 * (limit licencji, uprawnienia i walidację egzekwuje apps/api).
 */
export default function ImportUsersModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [step, setStep] = useState<Step>('loading');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seatSettingsLink, setSeatSettingsLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Po otwarciu: jeśli jest trwający albo świeżo zakończony import, pokazujemy jego postęp (kreator można zamknąć bez utraty stanu).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/users/import/latest');
        const data = await response.json().catch(() => null);
        if (cancelled) return;
        if (response.ok && data?.batch) {
          setSummary(data.batch as ImportSummary);
          setStep('progress');
          return;
        }
      } catch {
        // brak informacji o poprzednim imporcie nie blokuje nowego
      }
      if (!cancelled) setStep('select');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/users/import/${id}`);
      const data = await response.json().catch(() => null);
      if (response.ok && data) {
        setSummary(data as ImportSummary);
        return data as ImportSummary;
      }
    } catch {
      // następna próba przy kolejnym odczycie
    }
    return null;
  }, []);

  // Postęp: odczyt co POLL_MS, dopóki import trwa.
  const summaryId = summary?.id;
  const running = summary?.status === 'PROCESSING';
  useEffect(() => {
    if (step !== 'progress' || !summaryId || !running) return undefined;
    const timer = setInterval(() => {
      void refresh(summaryId);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [step, summaryId, running, refresh]);

  async function upload(file: File) {
    setError(null);
    setSeatSettingsLink(false);
    if (file.size > IMPORT_MAX_BYTES) {
      setError('Plik jest za duży (limit: 1 MB).');
      return;
    }
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/users/import/preview', { method: 'POST', body: formData });
      const data = (await response.json().catch(() => null)) as (ImportPreview & ImportApiError) | null;
      if (!response.ok) {
        setError(response.status === 413 ? 'Plik jest za duży (limit: 1 MB).' : messageOf(data, 'Nie udało się przetworzyć pliku.'));
        return;
      }
      setPreview(data as ImportPreview);
      setStep('preview');
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setBusy(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) void upload(dropped);
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    setSeatSettingsLink(false);
    try {
      const response = await fetch(`/api/users/import/${preview.id}/confirm`, { method: 'POST' });
      const data = (await response.json().catch(() => null)) as (ImportSummary & ImportApiError) | null;
      if (!response.ok) {
        setError(messageOf(data, 'Nie udało się potwierdzić importu.'));
        if (data?.code === 'SEAT_LIMIT') {
          setSeatSettingsLink(true);
          const fresh = await refresh(preview.id);
          if (fresh) setPreview((current) => (current ? { ...current, seats: fresh.seats } : current));
        }
        return;
      }
      setSummary(data as ImportSummary);
      setStep('progress');
      onChanged();
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelPreview() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await fetch(`/api/users/import/${preview.id}`, { method: 'DELETE' });
    } catch {
      // podgląd i tak wygaśnie po 24 h
    } finally {
      setBusy(false);
      setPreview(null);
      setStep('select');
    }
  }

  async function stopInvites() {
    if (!summary) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/users/import/${summary.id}/stop`, { method: 'POST' });
      const data = (await response.json().catch(() => null)) as (ImportSummary & ImportApiError) | null;
      if (!response.ok) {
        setError(messageOf(data, 'Nie udało się zatrzymać wysyłki.'));
        return;
      }
      setSummary(data as ImportSummary);
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setBusy(false);
      setConfirmingStop(false);
    }
  }

  function startNewImport() {
    setSummary(null);
    setPreview(null);
    setError(null);
    setStep('select');
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="import-users-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-card border border-border bg-surface p-6 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="import-users-title" className="text-lg font-bold tracking-[-0.01em]">
            Importuj z CSV
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Zamknij
          </Button>
        </div>

        {error && (
          <p role="alert" className="mb-4 rounded-btn bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
            {seatSettingsLink && (
              <>
                {' '}
                <a href={SETTINGS_HREF} className="font-bold underline">
                  Przejdź do ustawień
                </a>
              </>
            )}
          </p>
        )}

        {step === 'loading' && <p className="text-sm text-muted">Ładowanie...</p>}

        {step === 'select' && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Wgraj plik CSV z pracownikami (kolumny: e-mail, imię, nazwisko, opcjonalnie dział; nagłówki po polsku lub angielsku). Limit: {IMPORT_MAX_ROWS} wierszy i 1 MB, kodowanie UTF-8. Przed dodaniem kont zobaczysz podgląd z błędami.
            </p>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`rounded-card border-2 border-dashed p-8 text-center text-sm ${isDragging ? 'border-accent bg-accent-soft' : 'border-border bg-paper'}`}
            >
              <p className="mb-3 font-semibold">Przeciągnij plik CSV tutaj</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                aria-label="Plik CSV"
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  if (selected) void upload(selected);
                  event.target.value = '';
                }}
              />
              <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                {busy ? 'Przetwarzanie...' : 'Wybierz plik'}
              </Button>
            </div>
            <p className="text-xs text-muted">
              Z Excela: Plik → Zapisz jako → typ „CSV UTF-8 (rozdzielany przecinkami)”. Zwykły „CSV” zapisuje polskie znaki w innym kodowaniu i zostanie odrzucony.
            </p>
            <Button variant="ghost" size="sm" onClick={downloadTemplate}>
              Pobierz szablon
            </Button>
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Plik <strong>{preview.fileName ?? 'import.csv'}</strong>: {preview.totalRows} {preview.totalRows === 1 ? 'wiersz' : 'wierszy'}. Nic nie zostało jeszcze dodane.
            </p>
            <dl className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="rounded-btn bg-success-soft px-3 py-2">
                <dt className="text-xs font-bold uppercase tracking-wide text-success">Do dodania</dt>
                <dd className="text-xl font-extrabold">{preview.validCount}</dd>
              </div>
              <div className="rounded-btn bg-paper px-3 py-2">
                <dt className="text-xs font-bold uppercase tracking-wide text-muted">Już istnieją</dt>
                <dd className="text-xl font-extrabold">{preview.existingCount}</dd>
              </div>
              <div className="rounded-btn bg-danger-soft px-3 py-2">
                <dt className="text-xs font-bold uppercase tracking-wide text-danger">Błędy</dt>
                <dd className="text-xl font-extrabold">{preview.errorCount}</dd>
              </div>
            </dl>
            {preview.existingCount > 0 && <p className="text-xs text-muted">Osoby, które mają już konto w organizacji, zostaną pominięte (nic nie nadpisujemy).</p>}
            {preview.ignoredColumns.length > 0 && <p className="text-xs text-muted">Pominięte kolumny: {preview.ignoredColumns.join(', ')}.</p>}

            {preview.seats.ok ? (
              <p className="rounded-btn bg-paper px-3 py-2 text-sm">
                Licencje: wykorzystano {preview.seats.used} z {preview.seats.limit}; po imporcie {preview.seats.used + preview.seats.required}.
              </p>
            ) : (
              <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 text-sm text-danger">
                <strong>Brakuje {preview.seats.missing} licencji.</strong> Potrzeba {preview.seats.required}, dostępnych {preview.seats.available} (wykorzystano {preview.seats.used} z {preview.seats.limit}). Zmień plan w{' '}
                <a href={SETTINGS_HREF} className="font-bold underline">
                  ustawieniach
                </a>{' '}
                albo zmniejsz liczbę osób w pliku - import nie zostanie wykonany, dopóki wszyscy się nie zmieszczą.
              </p>
            )}

            {preview.errors.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-bold">Błędy w pliku (te wiersze zostaną pominięte)</h3>
                <div className="max-h-48 overflow-y-auto rounded-btn border border-border">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border uppercase tracking-wide text-muted">
                        <th className="px-3 py-2">Wiersz</th>
                        <th className="px-3 py-2">E-mail</th>
                        <th className="px-3 py-2">Powód</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.errors.map((item) => (
                        <tr key={item.line} className="border-b border-border last:border-0">
                          <td className="px-3 py-1.5">{item.line}</td>
                          <td className="px-3 py-1.5 break-all">{item.email}</td>
                          <td className="px-3 py-1.5">{item.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.errorsTruncated && (
                  <p className="mt-1 text-xs text-muted">
                    Pokazano {preview.errors.length} z {preview.errorCount} błędów. Pełna lista jest w raporcie CSV.
                  </p>
                )}
              </div>
            )}

            {preview.sample.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-bold">Przykładowe wiersze do dodania</h3>
                <div className="max-h-40 overflow-y-auto rounded-btn border border-border">
                  <table className="w-full text-left text-xs">
                    <tbody>
                      {preview.sample.map((row) => (
                        <tr key={row.line} className="border-b border-border last:border-0">
                          <td className="px-3 py-1.5">{row.firstName} {row.lastName}</td>
                          <td className="px-3 py-1.5 break-all">{row.email}</td>
                          <td className="px-3 py-1.5 text-muted">{row.departmentName ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <div className="flex gap-2">
                <Button variant="secondary" onClick={cancelPreview} disabled={busy}>
                  Anuluj import
                </Button>
                <a href={`/api/users/import/${preview.id}/report`} download className="inline-flex items-center px-2 text-sm font-bold text-accent-ink hover:underline">
                  Pobierz raport CSV
                </a>
              </div>
              <Button onClick={confirm} disabled={busy || preview.validCount === 0 || !preview.seats.ok}>
                {busy ? 'Importowanie...' : `Zaimportuj ${preview.validCount} ${preview.validCount === 1 ? 'osobę' : 'osób'}`}
              </Button>
            </div>
          </div>
        )}

        {step === 'progress' && summary && <ProgressView summary={summary} busy={busy} confirmingStop={confirmingStop} onAskStop={() => setConfirmingStop(true)} onCancelStop={() => setConfirmingStop(false)} onStop={stopInvites} onNew={startNewImport} />}
      </div>
    </div>
  );
}

function ProgressView({
  summary,
  busy,
  confirmingStop,
  onAskStop,
  onCancelStop,
  onStop,
  onNew,
}: {
  summary: ImportSummary;
  busy: boolean;
  confirmingStop: boolean;
  onAskStop: () => void;
  onCancelStop: () => void;
  onStop: () => void;
  onNew: () => void;
}) {
  const progress = summary.progress;
  if (!progress) return null;
  const percent = progress.invitesTotal === 0 ? 100 : Math.round((progress.invitesSent / progress.invitesTotal) * 100);
  const running = summary.status === 'PROCESSING';

  return (
    <div className="space-y-4">
      <p className="text-sm">
        <strong>{running ? 'Import w toku' : 'Import zakończony'}</strong>
        {summary.fileName ? ` - ${summary.fileName}` : ''}
      </p>
      <p className="text-sm">
        Utworzono konta: <strong>{progress.accountsCreated}</strong>
        {progress.accountsFailed > 0 && <span className="text-danger"> (nie utworzono: {progress.accountsFailed} - adres niedostępny)</span>}
        {summary.existingCount > 0 && <span className="text-muted"> - pominięto istniejących: {summary.existingCount}</span>}
        {summary.errorCount > 0 && <span className="text-muted"> - błędnych wierszy: {summary.errorCount}</span>}
      </p>

      <div>
        <div className="mb-1 flex items-baseline justify-between text-sm">
          <span>
            Wysłano <strong>{progress.invitesSent}</strong> z <strong>{progress.invitesTotal}</strong> zaproszeń
            {running && progress.remaining > 0 && <>, reszta {progress.restTomorrow ? 'jutro i w kolejnych dniach' : 'w ciągu kilku minut'}</>}
          </span>
          <span className="text-muted">{percent}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-paper" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Postęp wysyłki zaproszeń">
          <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
      </div>

      {running && progress.remaining > 0 && (
        <p className="rounded-btn bg-paper px-3 py-2 text-xs text-muted">
          Zaproszenia wysyłamy partiami, w ramach dziennego limitu {progress.dailyLimit} zaproszeń na organizację (limit chroni przed spamem i jest wspólny z zaproszeniami wysyłanymi ręcznie). Dziś zostało jeszcze {progress.dailyRemaining}.
          {progress.estimatedCompletionAt && <> Szacowane zakończenie: <strong>{formatDateTime(progress.estimatedCompletionAt)}</strong>.</>}
        </p>
      )}
      {progress.invites.failed > 0 && (
        <p className="text-xs text-danger">Nie udało się wysłać {progress.invites.failed} zaproszeń - użyj „Wyślij zaproszenie ponownie” przy koncie (szczegóły w raporcie CSV).</p>
      )}
      {progress.invites.expired > 0 && <p className="text-xs text-muted">Wygasło zaproszeń: {progress.invites.expired} (konto nie zostało aktywowane w ciągu 30 dni albo adres został przypisany do innej organizacji).</p>}
      {progress.invites.skipped > 0 &&<p className="text-xs text-muted">Pominięto zaproszeń: {progress.invites.skipped} (konto aktywne, usunięte albo wysyłka zatrzymana).</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <a href={`/api/users/import/${summary.id}/report`} download className="text-sm font-bold text-accent-ink hover:underline">
          Pobierz raport CSV
        </a>
        <div className="flex gap-2">
          {running && !confirmingStop && (
            <Button variant="secondary" onClick={onAskStop} disabled={busy}>
              Zatrzymaj wysyłkę
            </Button>
          )}
          {running && confirmingStop && (
            <>
              <span className="self-center text-xs text-muted">Konta zostają, oczekujące zaproszenia nie zostaną wysłane.</span>
              <Button variant="secondary" onClick={onCancelStop} disabled={busy}>
                Wróć
              </Button>
              <Button onClick={onStop} disabled={busy}>
                Tak, zatrzymaj
              </Button>
            </>
          )}
          {!running && <Button onClick={onNew}>Nowy import</Button>}
        </div>
      </div>
    </div>
  );
}
