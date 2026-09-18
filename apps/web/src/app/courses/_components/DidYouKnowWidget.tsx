'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react';
import Card from '@/components/ui/Card';

// Treść statyczna, hardkodowana po stronie frontendu - jak AVATAR_PRESETS,
// nie ma dziś żadnego endpointu/tabeli z faktami. Backlog: gdyby to miało
// się rozrastać (więcej faktów, zarządzanie treścią przez admina), warto
// przenieść do bazy - na razie to zbyt mała treść, żeby uzasadniać endpoint.
const FACTS: string[] = [
  'Średnio co 39 sekund dochodzi do ataku hakerskiego na urządzenie podłączone do internetu.',
  'Ponad 90% udanych ataków zaczyna się od wiadomości phishingowej.',
  'Facebook usuwa średnio 7,7 miliona fałszywych kont dziennie.',
  'Najczęściej używane hasło na świecie to wciąż "123456".',
  'Złamanie 8-znakowego hasła złożonego wyłącznie z małych liter zajmuje komputerowi mniej niż sekundę.',
  'Uwierzytelnianie dwuskładnikowe (2FA) blokuje ponad 99% zautomatyzowanych ataków na konta.',
  'Menedżery haseł pozwalają używać unikalnego, silnego hasła w każdym serwisie bez konieczności zapamiętywania ich wszystkich.',
  'Atakujący często kupują wykradzione dane logowania na czarnym rynku i testują je automatycznie w wielu serwisach naraz ("credential stuffing").',
  'Fałszywe domeny podszywające się pod znane marki często różnią się jedną literą lub cyfrą (np. "g00gle" zamiast "google").',
  'Ransomware może zaszyfrować pliki firmy w ciągu kilku minut od otwarcia złośliwego załącznika.',
];

export default function DidYouKnowWidget() {
  const [index, setIndex] = useState(0);

  function goTo(delta: 1 | -1) {
    setIndex((current) => (current + delta + FACTS.length) % FACTS.length);
  }

  const arrowClasses =
    'flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted hover:bg-paper';

  return (
    <Card className="flex flex-col items-center gap-2 p-[22px] text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning-soft text-warning" aria-hidden="true">
        <Lightbulb size={20} strokeWidth={2.2} />
      </span>
      <h3 className="font-bold">Czy wiedziałeś/aś?</h3>
      <p className="text-muted">{FACTS[index]}</p>

      <div className="flex items-center justify-center gap-3 text-xs font-semibold text-muted">
        <button type="button" onClick={() => goTo(-1)} aria-label="Poprzedni fakt" className={arrowClasses}>
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <span>{`${index + 1}/${FACTS.length}`}</span>
        <button type="button" onClick={() => goTo(1)} aria-label="Następny fakt" className={arrowClasses}>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </Card>
  );
}
