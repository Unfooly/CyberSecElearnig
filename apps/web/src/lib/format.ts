// 'YYYY-MM' -> np. "wrz 2026" (polska nazwa miesiąca, UTC - tak jak liczy
// backend, żeby etykieta nie przeskakiwała o miesiąc w innych strefach).
export function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('pl-PL', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, monthNumber - 1, 1)),
  );
}

export function formatDateTime(iso: string | null): string {
  if (!iso) {
    return 'Brak aktywności';
  }
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}
