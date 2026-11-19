import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { ContentLocale, ltext, localizeContent, moduleCoverSchema } from '@cyberszkolo/content';

/**
 * Dane ekranu startu i końca modułu (szablon modułu Unfooly, D-163) spoza kolumn `courses`: okładki (`cover`), numer sprawy (`caseNumber`)
 * i podtytuł we wszystkich językach. Bez migracji (decyzja właściciela): czytamy je z plików module.json, które i tak są w obrazie API
 * (Dockerfile, dla content-import) - te same pliki, z których import zapisał kurs, więc wartości są spójne z wdrożoną treścią.
 *
 * Treść tylko do wyświetlania (jak miniatura w `courses.thumbnail`), poza wersją kursu: poprawka okładki działa od razu, także dla
 * przypisań przypiętych do starszej wersji. Żadnych danych klienta, odpowiedzi ani pól `secret` - z pliku bierzemy WYŁĄCZNIE pola
 * wyświetlane niżej (okładki, numer, podtytuł, uwaga startu - D-171), każde zwalidowane wąskim schematem (reszta module.json, w tym klucze odpowiedzi, nie jest nawet parsowana do pamięci podręcznej).
 */

// Wąski schemat: tylko pola ekranu startu. `passthrough` nie - nieznane pola po prostu odrzucamy (z.object bez strict pomija je).
const moduleMetaSchema = z.object({
  slug: z.string(),
  cover: moduleCoverSchema.optional(),
  caseNumber: z.number().int().min(1).max(999).optional(),
  subtitle: ltext(300).optional(),
  // Uwaga na ekranie startu w czerwonej ramce (D-171) - sam tekst, niczego nie blokuje.
  startNotice: ltext(200).optional(),
});
type StoredModuleMeta = z.infer<typeof moduleMetaSchema>;

export interface ModuleCover {
  start: string;
  end: string;
  startPortrait: string | null;
  endPortrait: string | null;
  /** Tło odtwarzacza za blokami (D-178); null - bez tła. */
  backdrop: string | null;
  backdropPortrait: string | null;
}

export interface ModuleMeta {
  cover: ModuleCover | null;
  caseNumber: number | null;
  /** Podtytuł w języku treści; null - brak w pliku (wtedy polska kolumna `courses.subtitle`). */
  subtitle: string | null;
  /** Uwaga na ekranie startu (D-171) w języku treści; null - brak. */
  notice: string | null;
}

const EMPTY_META: ModuleMeta = { cover: null, caseNumber: null, subtitle: null, notice: null };

// Jak content-import (apps/api/dist/scripts -> /app): z apps/api/{src,dist}/courses cztery poziomy w górę to korzeń repo/obrazu.
const DEFAULT_MODULES_DIR = path.resolve(__dirname, '../../../../packages/content/modules');
const logger = new Logger('ModuleMeta');

let cache: Map<string, StoredModuleMeta> | null = null;

/** Wczytuje module.json wszystkich modułów RAZ (pliki w obrazie się nie zmieniają). Uszkodzony albo niepasujący plik - pomijany z ostrzeżeniem. */
export function loadModuleMeta(dir: string = DEFAULT_MODULES_DIR): Map<string, StoredModuleMeta> {
  const result = new Map<string, StoredModuleMeta>();
  let entries: string[];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      // Kolejność readdir zależy od systemu plików (ext4 - wg hasza nazw) - sortujemy, żeby wybór przy duplikacie był deterministyczny.
      .sort();
  } catch {
    logger.warn('Brak katalogu modułów treści - ekran startu bez okładek i numerów spraw');
    return result;
  }
  for (const name of entries) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path.join(dir, name, 'module.json'), 'utf8'));
    } catch (error) {
      // Katalog bez module.json (wspólne assety) - po cichu, jak content-import; inny błąd odczytu - ostrzeżenie bez treści pliku.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn(`Nie udało się odczytać module.json modułu ${name}`);
      continue;
    }
    const parsed = moduleMetaSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(`Niepoprawne metadane ekranu startu w module ${name} - pominięte`);
      continue;
    }
    // Import i tak wymusza unikalny slug (courses.slug @unique) - duplikat to błąd treści; zostaje pierwszy, z ostrzeżeniem.
    if (result.has(parsed.data.slug)) {
      logger.warn(`Powtórzony slug ${parsed.data.slug} (katalog ${name}) - pominięty`);
      continue;
    }
    result.set(parsed.data.slug, parsed.data);
  }
  return result;
}

/**
 * Wczytanie przy starcie API (CoursesService.onModuleInit), żeby koszt odczytu nie spadał na pierwsze żądanie. Brak katalogu albo błąd
 * odczytu zostaje w pamięci do restartu (pusta mapa: ekran startu bez okładek i numerów, ostrzeżenie w logu) - pliki w obrazie się nie zmieniają.
 */
export function warmModuleMeta(): void {
  cache ??= loadModuleMeta();
}

/** Dane ekranu startu modułu `slug` w języku treści; kurs bez pliku (np. utworzony wprost) - same null. */
export function moduleMetaFor(slug: string, locale: ContentLocale): ModuleMeta {
  warmModuleMeta();
  if (!cache) return { ...EMPTY_META };
  const stored = cache.get(slug);
  if (!stored) return { ...EMPTY_META };
  const cover = stored.cover ? localizeContent(stored.cover, locale) : undefined;
  const subtitle = stored.subtitle === undefined ? null : localizeContent(stored.subtitle, locale);
  const notice = stored.startNotice === undefined ? null : localizeContent(stored.startNotice, locale);
  return {
    cover: cover
      ? {
          start: cover.start,
          end: cover.end,
          startPortrait: cover.startPortrait ?? null,
          endPortrait: cover.endPortrait ?? null,
          backdrop: cover.backdrop ?? null,
          backdropPortrait: cover.backdropPortrait ?? null,
        }
      : null,
    caseNumber: stored.caseNumber ?? null,
    subtitle: typeof subtitle === 'string' ? subtitle : null,
    notice: typeof notice === 'string' ? notice : null,
  };
}

/** Tylko testy: podmiana pamięci podręcznej (katalog z plikami testowymi albo pusty). */
export function setModuleMetaCacheForTests(next: Map<string, StoredModuleMeta> | null): void {
  cache = next;
}
