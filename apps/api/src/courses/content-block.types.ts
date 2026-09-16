// Postgres ma enum ContentBlockType (schema.prisma), ale Prisma Client go nie
// eksportuje - żadne pole modelu nie ma tego typu (contentBlocks jest Json,
// "type" bloku to zwykły string w środku). Wartości muszą być identyczne z
// enumem w schema.prisma.
export type ContentBlockType = 'VIDEO' | 'QUIZ' | 'BRANCHING_SCENARIO' | 'DRAG_AND_DROP';
