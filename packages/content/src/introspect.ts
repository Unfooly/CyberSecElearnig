import { z } from 'zod';
import { isLocalizedSchema } from './common';

/** Ścieżki pól liściowych DANYCH (`a.b`, `a[].b`) - do sprawdzania, które pola faktycznie trafiły do odpowiedzi. */
export function collectPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((item) => collectPaths(item, `${prefix}[]`)))];
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      collectPaths(item, prefix ? `${prefix}.${key}` : key),
    );
  }
  return value === undefined ? [] : [prefix];
}

/**
 * Ścieżki pól WIELOJĘZYCZNYCH schematu (`a.b`, tablice `a[].b`) - pole, które w treści może być `{ pl, en? }` (D-133: kompletność języków z
 * `locales` - zwykły string w takim polu to tylko `pl`). Nie schodzi w głąb pola wielojęzycznego.
 */
export function localizedFieldPaths(schema: z.ZodTypeAny, prefix = ''): string[] {
  const def = schema._def as { typeName: string } & Record<string, unknown>;
  if (isLocalizedSchema(schema)) return [prefix];
  switch (def.typeName) {
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
      return localizedFieldPaths(def.innerType as z.ZodTypeAny, prefix);
    case 'ZodEffects':
      return localizedFieldPaths(def.schema as z.ZodTypeAny, prefix);
    case 'ZodObject':
      return Object.entries((schema as z.ZodObject<z.ZodRawShape>).shape).flatMap(([key, value]) => localizedFieldPaths(value, prefix ? `${prefix}.${key}` : key));
    case 'ZodArray':
      return localizedFieldPaths(def.type as z.ZodTypeAny, `${prefix}[]`);
    case 'ZodTuple':
      return [...new Set((def.items as z.ZodTypeAny[]).flatMap((item) => localizedFieldPaths(item, `${prefix}[]`)))];
    case 'ZodDiscriminatedUnion':
    case 'ZodUnion':
      return [...new Set((def.options as z.ZodTypeAny[]).flatMap((option) => localizedFieldPaths(option, prefix)))];
    default:
      return [];
  }
}

/**
 * Ścieżki wszystkich pól liściowych schematu zod (`a.b`, tablice `a[].b`). Służy testowi kompletności klasyfikacji pól
 * (blocks.ts, FIELD_CLASSIFICATION): nowe pole w schemacie bez decyzji "client albo secret" ma wywalić CI.
 */
export function leafPaths(schema: z.ZodTypeAny, prefix = ''): string[] {
  const def = schema._def as { typeName: string } & Record<string, unknown>;
  // Pole wielojęzyczne (schemaVersion 6): klasyfikacja jak wariantu jednojęzycznego (pierwsza opcja unii) - klient dostaje treść
  // już rozwiniętą do jednego języka (toClientBlock), więc ścieżki `pl`/`en` nigdy nie trafiają do odpowiedzi.
  if (isLocalizedSchema(schema)) return leafPaths((def.options as z.ZodTypeAny[])[0], prefix);
  switch (def.typeName) {
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
      return leafPaths(def.innerType as z.ZodTypeAny, prefix);
    case 'ZodEffects':
      return leafPaths(def.schema as z.ZodTypeAny, prefix);
    case 'ZodObject': {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      return Object.entries(shape).flatMap(([key, value]) => leafPaths(value, prefix ? `${prefix}.${key}` : key));
    }
    case 'ZodArray':
      return leafPaths(def.type as z.ZodTypeAny, `${prefix}[]`);
    case 'ZodTuple': {
      const items = def.items as z.ZodTypeAny[];
      return [...new Set(items.flatMap((item) => leafPaths(item, `${prefix}[]`)))];
    }
    case 'ZodDiscriminatedUnion': {
      // Warianty dzielą pole dyskryminujące (np. `kind`) - Set scala je zamiast duplikować; pola specyficzne dla
      // jednego wariantu i tak trafiają na listę (klasyfikacja musi zdecydować o KAŻDYM z nich, niezależnie od reszty).
      const options = def.options as z.ZodTypeAny[];
      return [...new Set(options.flatMap((option) => leafPaths(option, prefix)))];
    }
    case 'ZodLiteral':
    case 'ZodString':
    case 'ZodNumber':
    case 'ZodBoolean':
    case 'ZodEnum':
      return [prefix];
    default:
      throw new Error(`leafPaths: nieobsłużony typ zod ${def.typeName} przy "${prefix}" - rozszerz introspekcję`);
  }
}
