'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import type { PhishingTemplate, PhishingTemplateEdit, TemplatePreview } from '@/lib/phishing-types';

const INPUT =
  'h-10 w-full rounded-btn border border-border bg-surface px-3 text-sm font-medium focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:bg-paper disabled:text-muted';
const TEXTAREA =
  'w-full rounded-btn border border-border bg-surface p-3 font-mono text-[13px] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:bg-paper disabled:text-muted';

const ACTION_LABEL: Record<PhishingTemplateEdit['action'], string> = {
  CLONED: 'Utworzono (klon)',
  UPDATED: 'Zmieniono',
  DELETED: 'Usunięto',
};

// Podgląd sanityzowanego HTML w piaskownicy (iframe bez skryptów) - nawet błąd sanityzera nie uruchomi kodu.
// {{trackingLink}} w podglądzie prowadzi donikąd (#).
function PreviewFrame({ title, html }: { title: string; html: string }) {
  const doc = `<!doctype html><meta charset="utf-8"><base target="_blank"><body style="font-family:sans-serif;font-size:14px;padding:12px">${html.replaceAll('{{trackingLink}}', '#')}</body>`;
  return <iframe title={title} sandbox="" srcDoc={doc} className="h-56 w-full rounded-btn border border-border bg-white" />;
}

export default function TemplateEditor({ template, edits }: { template: PhishingTemplate; edits: PhishingTemplateEdit[] }) {
  const router = useRouter();
  const readOnly = template.scope === 'GLOBAL';
  const domain = template.senderAddress?.split('@')[1] ?? null;

  const [values, setValues] = useState({
    name: template.name,
    subject: template.subject,
    senderName: template.senderName,
    senderLocalPart: template.senderLocalPart,
    bodyHtml: template.bodyHtml,
    lessonHtml: template.lessonHtml,
  });
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState<'save' | 'delete' | 'clone' | null>(null);

  function set(name: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  // Podgląd "co zostanie po sanityzacji" - odpytujemy API (jedno źródło prawdy o allow-liście), z opóźnieniem.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/phishing/templates/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bodyHtml: values.bodyHtml, lessonHtml: values.lessonHtml }),
        });
        if (response.ok && !cancelled) {
          setPreview((await response.json()) as TemplatePreview);
        }
      } catch {
        // Brak podglądu nie blokuje edycji.
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [values.bodyHtml, values.lessonHtml]);

  async function call(action: 'save' | 'delete' | 'clone') {
    setBusy(action);
    setMessage(null);
    try {
      const url = action === 'clone' ? `/api/phishing/templates/${template.id}/clone` : `/api/phishing/templates/${template.id}`;
      const response = await fetch(url, {
        method: action === 'save' ? 'PATCH' : action === 'delete' ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(action === 'delete' ? {} : { body: JSON.stringify(action === 'save' ? values : {}) }),
      });
      const data = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) {
        const text = Array.isArray(data?.message) ? data.message[0] : data?.message;
        setMessage({ kind: 'error', text: text ?? 'Operacja nie powiodła się.' });
        return;
      }
      if (action === 'delete') {
        router.push('/dashboard/phishing/templates');
        return;
      }
      if (action === 'clone') {
        router.push(`/dashboard/phishing/templates/${data.id}`);
        return;
      }
      setMessage({ kind: 'success', text: 'Zapisano. Treść została oczyszczona wg allow-listy (zobacz podgląd).' });
      router.refresh();
    } catch {
      setMessage({ kind: 'error', text: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' });
    } finally {
      setBusy(null);
    }
  }

  function handleDelete() {
    if (window.confirm('Usunąć ten szablon? Trwające i zakończone kampanie mają własną kopię treści i nie zostaną naruszone.')) {
      void call('delete');
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        {readOnly && (
          <p role="note" className="rounded-btn bg-paper px-3 py-2 text-sm text-muted">
            To szablon globalny - tylko do odczytu. Sklonuj go, aby dostosować treść.
          </p>
        )}
        <Card>
          <CardHeader title="Nadawca i temat" />
          <div className="space-y-4 p-5">
            <div>
              <label htmlFor="name" className="mb-1 block text-sm font-semibold">Nazwa szablonu</label>
              <input id="name" className={INPUT} value={values.name} disabled={readOnly} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <label htmlFor="senderName" className="mb-1 block text-sm font-semibold">Nazwa wyświetlana nadawcy</label>
              <input id="senderName" className={INPUT} value={values.senderName} disabled={readOnly} onChange={(e) => set('senderName', e.target.value)} />
            </div>
            <div>
              <label htmlFor="senderLocalPart" className="mb-1 block text-sm font-semibold">Adres nadawcy</label>
              <div className="flex items-center gap-2">
                <input id="senderLocalPart" className={INPUT} value={values.senderLocalPart} disabled={readOnly} onChange={(e) => set('senderLocalPart', e.target.value)} />
                <span className="shrink-0 text-sm font-semibold text-muted">@{domain ?? '(domena nieskonfigurowana)'}</span>
              </div>
              <p className="mt-1 text-xs text-muted">Domena nadawcy jest zawsze nasza i nieedytowalna.</p>
            </div>
            <div>
              <label htmlFor="subject" className="mb-1 block text-sm font-semibold">Temat</label>
              <input id="subject" className={INPUT} value={values.subject} disabled={readOnly} onChange={(e) => set('subject', e.target.value)} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Treść maila (HTML)" />
          <div className="space-y-2 p-5">
            <label htmlFor="bodyHtml" className="sr-only">Treść maila</label>
            <textarea id="bodyHtml" rows={10} className={TEXTAREA} value={values.bodyHtml} disabled={readOnly} onChange={(e) => set('bodyHtml', e.target.value)} />
            <p className="text-xs text-muted">
              Dozwolone tagi formatujące. Jedyny dozwolony link to <code>{'{{trackingLink}}'}</code> (np.{' '}
              <code>{'<a href="{{trackingLink}}">Kliknij</a>'}</code>); inne linki, obrazy i skrypty są usuwane.
            </p>
            {preview && !preview.hasTrackingLink && (
              <p role="alert" className="text-xs font-semibold text-danger">Treść nie zawiera linku {'{{trackingLink}}'} - zapis zostanie odrzucony.</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={'Lekcja ("To była symulacja")'} />
          <div className="p-5">
            <label htmlFor="lessonHtml" className="sr-only">Treść lekcji</label>
            <textarea id="lessonHtml" rows={8} className={TEXTAREA} value={values.lessonHtml} disabled={readOnly} onChange={(e) => set('lessonHtml', e.target.value)} />
            <p className="mt-2 text-xs text-muted">Bez linków. Wyświetlana pracownikowi po kliknięciu.</p>
          </div>
        </Card>

        {message && (
          <p role={message.kind === 'error' ? 'alert' : 'status'} className={`rounded-btn px-3 py-2 text-sm font-semibold ${message.kind === 'error' ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
            {message.text}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {readOnly ? (
            <Button onClick={() => call('clone')} disabled={busy !== null}>{busy === 'clone' ? 'Klonowanie...' : 'Sklonuj, aby edytować'}</Button>
          ) : (
            <>
              <Button onClick={() => call('save')} disabled={busy !== null}>{busy === 'save' ? 'Zapisywanie...' : 'Zapisz'}</Button>
              <Button variant="secondary" onClick={handleDelete} disabled={busy !== null}>Usuń szablon</Button>
            </>
          )}
          <Link href="/dashboard/phishing/templates" className="inline-flex h-10 items-center text-sm font-semibold text-accent-ink hover:underline">
            Wróć do listy
          </Link>
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Podgląd maila (po sanityzacji)" />
          <div className="space-y-2 p-5">
            <p className="text-sm text-muted">
              <strong className="text-ink">{values.senderName}</strong> &lt;{values.senderLocalPart}@{domain ?? '...'}&gt;
              <br />
              Temat: {values.subject}
            </p>
            <PreviewFrame title="Podgląd treści maila" html={preview?.bodyHtml ?? ''} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Podgląd lekcji" />
          <div className="p-5">
            <PreviewFrame title="Podgląd lekcji" html={preview?.lessonHtml ?? ''} />
          </div>
        </Card>
        {!readOnly && (
          <Card>
            <CardHeader title="Historia zmian" />
            <div className="p-5">
              {edits.length === 0 ? (
                <p className="text-sm text-muted">Brak zmian.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {edits.map((edit) => (
                    <li key={edit.id}>
                      <span className="font-semibold">{ACTION_LABEL[edit.action]}</span> - {edit.actorEmail},{' '}
                      {new Date(edit.createdAt).toLocaleString('pl-PL')}
                      {edit.changedFields.length > 0 && <span className="text-muted"> ({edit.changedFields.join(', ')})</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
