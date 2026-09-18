// Postgres ma enum ContentBlockType (schema.prisma), ale Prisma Client go nie
// eksportuje - żadne pole modelu nie ma tego typu (contentBlocks jest Json,
// "type" bloku to zwykły string w środku). Wartości muszą być identyczne z
// enumem w schema.prisma.
//
// EMBEDDED_HTML: blok renderowany WYŁĄCZNIE w sandboxowanym <iframe>
// (apps/web/.../blocks/EmbeddedHtmlBlock.tsx) - jedyny typ bloku, który
// wykonuje dowolny, nieznany JS. Ukończenie jest zawsze niescorowane
// (jak VIDEO/DRAG_AND_DROP - patrz brak w SCOREABLE_BLOCK_TYPES w
// courses.service.ts) - wynik obliczony WEWNĄTRZ tego JS nigdy nie jest
// ufany przez backend, dokładnie jak każdy inny content block.
export type ContentBlockType = 'VIDEO' | 'QUIZ' | 'BRANCHING_SCENARIO' | 'DRAG_AND_DROP' | 'EMBEDDED_HTML';
