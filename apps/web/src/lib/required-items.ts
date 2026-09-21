// Elementy wymagane do ukończenia bloku eksploracyjnego (hotspoty, pytania dialogu). LUSTRO `requiredItemIds` z packages/content (serwer
// używa oryginału): web nie importuje wartości z pakietu (wciągnęłoby zod do paczki przeglądarki), a reguła musi być identyczna, bo
// serwer odrzuca odpowiedź bez wymaganych elementów. Zgodność pilnuje required-items.test.ts (porównanie z oryginałem).
//  1. jeśli którykolwiek element ma jawne `required` (true/false): wymagane są te z `required: true` (reszta to "smaczki");
//  2. inaczej stara lista `requiredX[]` (pusta = nic nie wymagane, jak na serwerze);
//  3. inaczej wszystkie.
export function requiredItemIds(items: readonly { id: string; required?: boolean }[], legacyRequired?: readonly string[]): string[] {
  if (items.some((item) => item.required !== undefined)) return items.filter((item) => item.required === true).map((item) => item.id);
  return legacyRequired ? [...legacyRequired] : items.map((item) => item.id);
}
