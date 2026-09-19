'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import type { PhishingTemplate } from '@/lib/phishing-types';

export default function TemplatesList({ initialTemplates }: { initialTemplates: PhishingTemplate[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClone(template: PhishingTemplate) {
    setBusyId(template.id);
    setError(null);
    try {
      const response = await fetch(`/api/phishing/templates/${template.id}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.message ?? 'Nie udało się sklonować szablonu.');
        return;
      }
      router.push(`/dashboard/phishing/templates/${data.id}`);
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">
        Szablony globalne są tylko do odczytu - sklonuj szablon, aby dostosować temat, treść i nadawcę. Adres
        nadawcy zawsze należy do naszej domeny symulacji; zmieniasz tylko jego część przed znakiem @.
      </p>
      {error && (
        <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <Card>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3">Nazwa</th>
              <th className="px-5 py-3">Typ</th>
              <th className="px-5 py-3">Nadawca</th>
              <th className="px-5 py-3">Temat</th>
              <th className="px-5 py-3 text-right">Akcje</th>
            </tr>
          </thead>
          <tbody>
            {initialTemplates.map((template) => (
              <tr key={template.id} className="border-b border-border last:border-0">
                <td className="px-5 py-3 font-semibold">{template.name}</td>
                <td className="px-5 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      template.scope === 'GLOBAL' ? 'bg-paper text-muted' : 'bg-accent-soft text-accent-ink'
                    }`}
                  >
                    {template.scope === 'GLOBAL' ? 'Globalny' : 'Własny'}
                  </span>
                </td>
                <td className="px-5 py-3 text-muted">
                  {template.senderName}
                  <br />
                  <span className="text-xs">{template.senderAddress ?? `${template.senderLocalPart}@(domena nieskonfigurowana)`}</span>
                </td>
                <td className="px-5 py-3 text-muted">{template.subject}</td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-2">
                    <Link
                      href={`/dashboard/phishing/templates/${template.id}`}
                      className="inline-flex h-8 items-center rounded-btn border border-border bg-surface px-3 text-[13px] font-bold hover:bg-paper"
                    >
                      {template.scope === 'GLOBAL' ? 'Podgląd' : 'Edytuj'}
                    </Link>
                    <Button size="sm" variant="secondary" onClick={() => handleClone(template)} disabled={busyId === template.id}>
                      {busyId === template.id ? 'Klonowanie...' : 'Klonuj'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
