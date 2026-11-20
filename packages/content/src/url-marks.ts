/**
 * Domeny drugiego poziomu, przy których reguła „druga kropka w lewo” daje ZŁĄ odpowiedź (`bank.com.pl` → `com.pl`) - adres z nimi jest
 * odrzucany (reguła z modułu 1 uczyłaby błędu). Lista dla adresów z polskich i najczęstszych zagranicznych domen; nie musi być pełna,
 * bo autor treści wybiera adres świadomie, a walidator odrzuca tylko znane pułapki.
 */
const SECOND_LEVEL_SUFFIXES = new Set([
  'com.pl', 'net.pl', 'org.pl', 'edu.pl', 'gov.pl', 'info.pl', 'biz.pl', 'waw.pl', 'krakow.pl',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'co.jp', 'com.br', 'co.nz', 'com.de',
]);

/**
 * Rozkład adresu na domenę według reguły z modułu 1 (D-181): pierwszy POJEDYNCZY ukośnik „/” po nazwie strony (nie te z „https://”),
 * a od niego w lewo DRUGA kropka - między nimi leży domena (np. `formularz-online.net` w
 * `https://fundacja-analityki.formularz-online.net/prelegenci/48213`). Wspólne dla walidacji treści (semantics.ts) i odtwarzacza
 * (TextInputBlock `markUrl`) - ta sama reguła po obu stronach. Indeksy są pozycjami znaków w `url`.
 *
 * `null`, gdy reguły nie da się zastosować albo dałaby złą odpowiedź: brak ukośnika po nazwie strony, mniej niż dwie kropki przed nim,
 * port, `?`, `#` albo `@` w nazwie hosta, puste etykiety (`..`) albo domena drugiego poziomu typu `com.pl` / `co.uk`.
 */
export function urlDomainMarks(url: string): { slash: number; dot: number; domain: string; hostStart: number } | null {
  const scheme = url.indexOf('://');
  const hostStart = scheme >= 0 ? scheme + 3 : 0;
  const slash = url.indexOf('/', hostStart);
  if (slash <= hostStart) return null;
  const host = url.slice(hostStart, slash);
  if (/[:?#@\s]/.test(host) || host.split('.').some((label) => label.length === 0)) return null;
  const firstDot = url.lastIndexOf('.', slash - 1);
  if (firstDot <= hostStart) return null;
  const dot = url.lastIndexOf('.', firstDot - 1);
  if (dot < hostStart) return null;
  const domain = url.slice(dot + 1, slash);
  if (SECOND_LEVEL_SUFFIXES.has(domain.toLowerCase())) return null;
  return { slash, dot, domain, hostStart };
}
