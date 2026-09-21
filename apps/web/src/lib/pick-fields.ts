// Allowlista pól ciała żądania BFF: zwraca NOWY obiekt tylko z wymienionymi polami, które faktycznie są w żądaniu (własne właściwości; kolejne
// pola, w tym `__proto__`, są pomijane), albo null, gdy ciało nie jest zwykłym obiektem JSON. Wartości przechodzą bez zmian: kształt i typy
// waliduje API (ValidationPipe z whitelist i forbidNonWhitelisted); tu odcinamy tylko obce pola (np. userId, organizationId, role, correct).
export function pickFields(body: unknown, fields: readonly string[]): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const source = body as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field === '__proto__') continue; // przypisanie result.__proto__ zmieniłoby prototyp wyniku
    if (Object.prototype.hasOwnProperty.call(source, field)) result[field] = source[field];
  }
  return result;
}
