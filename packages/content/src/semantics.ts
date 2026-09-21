import { ServerBlock } from './blocks';
import { collectPaths } from './introspect';
import { ContentModule, ContentValidationError, moduleSchema } from './module';
import { validateRegex } from './regex';

// Walidacja semantyczna modułu (relacje między polami, których zod nie wyrazi w schemacie obiektu, kompilacja wzorców RE2).
// Kod tylko dla Node (patrz regex.ts): eksportowany z `@cyberszkolo/content/dist/node`.

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

/** Dowód (evidence: true) musi mieć wpis w notatniku z rodzajem (kind), żeby każdy dowód miał ikonę. */
function evidenceErrors(label: string, item: { evidence?: boolean; note?: { text: string; kind?: string } }): string[] {
  if (item.evidence !== true) return [];
  const errors: string[] = [];
  if (!item.note) errors.push(`${label}: evidence wymaga pola note`);
  else if (!item.note.kind) errors.push(`${label}: evidence wymaga note.kind (ikona dowodu)`);
  return errors;
}

/** `required` jawnie ustawione co najmniej na jednym elemencie musi zostawiać co najmniej jeden element wymagany (przy obu sposobach wygrywa `required`). */
function checkRequiredFlags(label: string, items: { required?: boolean }[], errors: string[]) {
  if (!items.some((item) => item.required !== undefined)) return;
  if (!items.some((item) => item.required === true)) errors.push(`${label}: co najmniej jeden element musi mieć required: true`);
}

// Pola dostępne dopiero od schemaVersion 3 (moduł w wersji 2 ich nie używa). Ścieżki względem bloku: `a.b`, `a[].b`.
const V3_FEATURES = ['hotspots[].evidence', 'hotspots[].note', 'hotspots[].required', 'questions[].evidence', 'questions[].required',
  'questions[].lines', 'questions[].note.kind', 'character.avatar', 'criteria[].evidence', 'criteria[].note.kind'];

/** Pola z wersji 3 użyte w bloku (do sprawdzenia względem deklarowanego schemaVersion). */
export function v3FeaturesUsed(block: ServerBlock): string[] {
  const paths = new Set(collectPaths(block));
  return V3_FEATURES.filter((feature) => [...paths].some((path) => path === feature || path.startsWith(`${feature}.`) || path.startsWith(`${feature}[]`)));
}

/** Zwraca listę błędów semantycznych bloku (pusta = OK). */
export function validateBlockSemantics(block: ServerBlock): string[] {
  const errors: string[] = [];
  const checkUnique = (label: string, ids: string[]) => {
    for (const id of duplicates(ids)) errors.push(`${label}: powtórzony identyfikator "${id}"`);
  };
  const checkSubset = (label: string, required: string[] | undefined, ids: string[]) => {
    for (const id of required ?? []) {
      if (!ids.includes(id)) errors.push(`${label}: nieznany identyfikator "${id}"`);
    }
  };

  switch (block.type) {
    case 'QUIZ':
    case 'BRANCHING_SCENARIO': {
      block.options.forEach((option, i) => {
        const marks = Number(option.correct !== undefined) + Number(option.outcome !== undefined);
        if (marks !== 1) errors.push(`options[${i}]: dokładnie jedno z pól correct/outcome`);
        if (block.type === 'QUIZ' && option.outcome !== undefined) errors.push(`options[${i}]: QUIZ używa "correct"`);
        if (block.type === 'BRANCHING_SCENARIO' && option.correct !== undefined) {
          errors.push(`options[${i}]: BRANCHING_SCENARIO używa "outcome"`);
        }
      });
      const correct = block.options.filter((o) => o.correct === true || o.outcome === 'correct').length;
      if (correct < 1) errors.push('options: brak poprawnej opcji');
      break;
    }
    case 'SCENE_HOTSPOTS': {
      const ids = block.hotspots.map((h) => h.id);
      checkUnique('hotspots', ids);
      checkSubset('requiredHotspots', block.requiredHotspots, ids);
      block.hotspots.forEach((h, i) => {
        if (h.x + h.width > 100 || h.y + h.height > 100) errors.push(`hotspots[${i}]: obszar wychodzi poza obraz`);
        errors.push(...evidenceErrors(`hotspots[${i}]`, h));
      });
      checkRequiredFlags('hotspots', block.hotspots, errors);
      break;
    }
    case 'DIALOGUE': {
      const ids = block.questions.map((q) => q.id);
      checkUnique('questions', ids);
      checkSubset('requiredQuestions', block.requiredQuestions, ids);
      block.questions.forEach((q, i) => {
        if ((q.answer === undefined) === (q.lines === undefined)) {
          errors.push(`questions[${i}]: dokładnie jedno z pól answer / lines`);
        }
        errors.push(...evidenceErrors(`questions[${i}]`, q));
      });
      checkRequiredFlags('questions', block.questions, errors);
      break;
    }
    case 'EMAIL_ANALYSIS': {
      checkUnique('criteria', block.criteria.map((c) => c.id));
      checkUnique('email.links', block.email.links.map((l) => l.id));
      block.criteria.forEach((c, i) => {
        errors.push(...evidenceErrors(`criteria[${i}]`, c));
        if (c.evidence === true && c.correct !== true) errors.push(`criteria[${i}]: dowodem może być tylko kryterium poprawne (correct: true)`);
      });
      break;
    }
    case 'TEXT_INPUT_GUIDED': {
      if (block.answer.accept.length === 0 && block.answer.regex === undefined) {
        errors.push('answer: wymagane accept albo regex');
      }
      if (block.answer.regex !== undefined) {
        errors.push(...validateRegex(block.answer.regex));
      }
      if (block.hints.length >= block.maxAttempts) {
        errors.push('hints: podpowiedzi przysługują po błędnej próbie, więc musi ich być mniej niż maxAttempts');
      }
      break;
    }
    case 'ORDERING': {
      checkUnique('items', block.items.map((i) => i.id));
      break;
    }
    case 'TABS': {
      const ids = block.tabs.map((t) => t.id);
      checkUnique('tabs', ids);
      checkSubset('requiredTabs', block.requiredTabs, ids);
      break;
    }
    default:
      break;
  }
  return errors;
}

/**
 * Ostrzeżenia (NIE błędy) dla poprawnego modułu: przestarzałe pola, które nadal działają. Import wypisuje je autorowi. PR 4 usuwa
 * requiredHotspots[] / requiredQuestions[] po migracji fixtur.
 */
export function moduleWarnings(contentModule: ContentModule): string[] {
  const warnings: string[] = [];
  contentModule.blocks.forEach((block, index) => {
    const where = `blocks[${index}] (${block.id})`;
    if (block.type === 'SCENE_HOTSPOTS' && block.requiredHotspots !== undefined) {
      warnings.push(`${where}: requiredHotspots[] jest przestarzałe, użyj hotspots[].required`);
    }
    if (block.type === 'SCENE_HOTSPOTS') {
      block.hotspots.forEach((h, i) => {
        if (h.note && h.evidence !== true) warnings.push(`${where}: hotspots[${i}].note bez evidence: true nigdy nie trafi do notatnika`);
      });
    }
    if (block.type === 'DIALOGUE' && block.requiredQuestions !== undefined) {
      warnings.push(`${where}: requiredQuestions[] jest przestarzałe, użyj questions[].required`);
    }
  });
  return warnings;
}

/**
 * Waliduje moduł (schemat zod + relacje między polami + reguły całego modułu). Zwraca dane PO parsowaniu (z uzupełnionymi
 * wartościami domyślnymi) - właśnie ta postać jest zapisywana jako wersja kursu, więc serwer nie zgaduje domyślnych.
 */
export function parseModule(input: unknown): ContentModule {
  const parsed = moduleSchema.safeParse(input);
  if (!parsed.success) {
    throw new ContentValidationError(parsed.error.issues.map((i) => `${i.path.join('.') || '(moduł)'}: ${i.message}`));
  }
  const contentModule = parsed.data;
  const errors: string[] = [];

  const seen = new Set<string>();
  contentModule.blocks.forEach((block, index) => {
    if (seen.has(block.id)) errors.push(`blocks[${index}]: powtórzony identyfikator bloku "${block.id}"`);
    seen.add(block.id);
    for (const error of validateBlockSemantics(block)) errors.push(`blocks[${index}] (${block.id}): ${error}`);
    if (contentModule.schemaVersion < 3) {
      for (const feature of v3FeaturesUsed(block)) {
        errors.push(`blocks[${index}] (${block.id}): pole ${feature} wymaga schemaVersion 3`);
      }
    }
  });

  const summaries = contentModule.blocks.map((b, i) => (b.type === 'SUMMARY' ? i : -1)).filter((i) => i >= 0);
  if (summaries.length > 1) errors.push('SUMMARY: co najwyżej jeden blok podsumowania');
  if (summaries.length === 1 && summaries[0] !== contentModule.blocks.length - 1) {
    errors.push('SUMMARY: blok podsumowania musi być ostatni');
  }

  if (errors.length > 0) throw new ContentValidationError(errors);
  return contentModule;
}
