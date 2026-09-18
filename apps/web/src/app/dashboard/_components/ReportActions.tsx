'use client';

import { Printer, Upload } from 'lucide-react';
import Button, { ButtonLink } from '@/components/ui/Button';

// Przyciski raportu dla zarządu. CSV to zwykły link do BFF-proxy (cookie
// httpOnly jedzie z przeglądarką); PDF = systemowy druk strony ("Zapisz jako
// PDF"), style @media print w globals.css chowają nawigację i przyciski.
export default function ReportActions() {
  return (
    <>
      <ButtonLink href="/api/dashboard/export" download variant="secondary" icon={<Upload size={16} strokeWidth={2.2} aria-hidden="true" />}>
        Pobierz raport CSV
      </ButtonLink>
      <Button variant="ghost" onClick={() => window.print()} icon={<Printer size={16} strokeWidth={2.2} aria-hidden="true" />}>
        Drukuj raport
      </Button>
    </>
  );
}
