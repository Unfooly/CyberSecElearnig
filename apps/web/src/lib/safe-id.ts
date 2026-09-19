// Identyfikatory zasobów (cuid, klucze seedów): litery, cyfry, _ i -, do 64 znaków. BFF przepuszcza do
// ścieżek API wyłącznie takie wartości (brak wstrzykiwania segmentów ścieżki: "..", "/", "?", "%").
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}
