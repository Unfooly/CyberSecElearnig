// Wartości do uzupełnienia na stronie głównej (sekcja "Cennik") - jedno
// miejsce, żeby marketing nie musiał szukać ich po komponentach.
// Nawiasy kwadratowe = placeholder; podmień na finalne kwoty (np. '19').
export const LANDING_PRICING = {
  // Cena za pracownika miesięcznie, w zł.
  pricePerEmployeeMonthly: '[CENA]',
  // Stała roczna opłata dla zespołów poniżej progu, w zł.
  smallTeamAnnualFee: '[KWOTA]',
  smallTeamThreshold: 20,
} as const;

// Publiczny adres serwisu - do metadanych (canonical, Open Graph).
export const SITE_URL = process.env.SITE_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:3000';
