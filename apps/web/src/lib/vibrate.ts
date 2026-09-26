// Krótka wibracja (feat/player-portrait, dotyk otwarcia hotspotu na telefonie) - feature-detected, bez flagi/ustawienia
// (nie proszone): na desktopie/przeglądarkach bez Vibration API `navigator.vibrate` jest `undefined`, `?.()` nic nie robi.
// Niektóre przeglądarki (Safari) w ogóle nie mają tego API - stąd też try/catch, nie tylko opcjonalne wołanie.
export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // niewspierane/zablokowane przez przeglądarkę - brak efektu, nie błąd
  }
}
