'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { buildCsvPreview, CSV_TEMPLATE, type CsvPreview } from '@/lib/csv';
import type { ImportCsvReport } from '@/lib/users-types';

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Nie udało się odczytać pliku.'));
    reader.readAsText(file);
  });
}

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'szablon-import-pracownikow.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ImportCsvModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportCsvReport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function handleFile(selected: File) {
    setFile(selected);
    setSubmitError(null);
    setReport(null);
    // FileReader zamiast Blob.text() - szersza kompatybilność (m.in. jsdom w
    // testach nie implementuje Blob.prototype.text()).
    try {
      const text = await readFileAsText(selected);
      setPreview(buildCsvPreview(text));
    } catch {
      setPreview({ validRows: [], invalidRows: [], fileError: 'Nie udało się odczytać pliku.' });
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) {
      void handleFile(dropped);
    }
  }

  async function handleImport() {
    if (!file) {
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/users/import-csv', { method: 'POST', body: formData });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setSubmitError(data?.message ?? 'Nie udało się zaimportować pliku.');
        return;
      }

      setReport(data as ImportCsvReport);
      onImported();
    } catch {
      setSubmitError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const canImport = Boolean(file) && !preview?.fileError && (preview?.validRows.length ?? 0) > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-csv-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-lg rounded-card border border-border bg-surface p-6 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="import-csv-title" className="text-lg font-bold tracking-[-0.01em]">
            Importuj z CSV
          </h2>
          <button
            type="button"
            onClick={downloadTemplate}
            className="text-sm font-semibold text-accent-ink underline"
          >
            Pobierz szablon CSV
          </button>
        </div>

        {!report && (
          <div
            role="button"
            tabIndex={0}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className={`mb-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center text-sm ${
              isDragging ? 'border-accent bg-accent-soft' : 'border-border text-muted'
            }`}
          >
            <p>{file ? file.name : 'Przeciągnij plik CSV tutaj albo kliknij, żeby wybrać'}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected) {
                  void handleFile(selected);
                }
              }}
            />
          </div>
        )}

        {preview?.fileError && (
          <p role="alert" className="mb-4 rounded-btn bg-danger-soft px-3 py-2 text-sm text-danger">
            {preview.fileError}
          </p>
        )}

        {preview && !preview.fileError && (
          <div className="mb-4 max-h-48 overflow-y-auto rounded-btn border border-border text-sm">
            <p className="border-b border-border bg-paper px-3 py-2 text-ink">
              {preview.validRows.length} poprawnych wierszy
              {preview.invalidRows.length > 0 ? `, ${preview.invalidRows.length} z błędami` : ''}
            </p>
            {preview.invalidRows.length > 0 && (
              <ul className="divide-y divide-border">
                {preview.invalidRows.map((row) => (
                  <li key={row.line} className="px-3 py-2 text-danger">
                    Wiersz {row.line} ({row.email || 'brak e-maila'}): {row.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {submitError && (
          <p role="alert" className="mb-4 rounded-btn bg-danger-soft px-3 py-2 text-sm text-danger">
            {submitError}
          </p>
        )}

        {report && (
          <div className="mb-4 rounded-btn border border-border text-sm">
            <p className="border-b border-border bg-success-soft px-3 py-2 text-success">
              Zaproszono {report.successCount} {report.successCount === 1 ? 'osobę' : 'osób'}
              {report.failedCount > 0 ? `, ${report.failedCount} wierszy odrzucono` : ''}
            </p>
            {report.emailFailedCount > 0 && (
              <p role="alert" className="border-b border-border bg-warning-soft px-3 py-2 text-warning">
                Dla {report.emailFailedCount} kont wiadomość z zaproszeniem NIE została wysłana - użyj
                &bdquo;Wyślij zaproszenie ponownie&rdquo; na liście.
              </p>
            )}
            {report.errors.length > 0 && (
              <ul className="max-h-40 divide-y divide-border overflow-y-auto">
                {report.errors.map((error) => (
                  <li key={`${error.line}-${error.email}`} className="px-3 py-2 text-danger">
                    Wiersz {error.line} ({error.email || 'brak e-maila'}): {error.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-btn px-4 text-sm font-bold text-accent-ink hover:bg-accent-soft"
          >
            {report ? 'Zamknij' : 'Anuluj'}
          </button>
          {!report && (
            <button
              type="button"
              onClick={handleImport}
              disabled={!canImport || isSubmitting}
              className="h-10 rounded-btn bg-accent px-4 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {isSubmitting ? 'Importowanie...' : 'Importuj'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
