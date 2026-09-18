'use client';

// Przyciski raportu dla zarządu. CSV to zwykły link do BFF-proxy (cookie
// httpOnly jedzie z przeglądarką); PDF = systemowy druk strony ("Zapisz jako
// PDF"), style @media print w globals.css chowają nawigację i przyciski.
export default function ReportActions() {
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <a
        href="/api/dashboard/export"
        download
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Pobierz raport CSV
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Drukuj raport
      </button>
    </div>
  );
}
