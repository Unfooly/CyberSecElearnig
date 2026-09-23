import { ServerBlock } from './blocks';
import { collectPaths } from './introspect';
import { ContentModule, ContentValidationError, MODULE_SCHEMA_VERSION, moduleSchema } from './module';
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

/**
 * Kształt hotspotu SCENE_HOTSPOTS wystarczający do spłaszczenia (id, required, evidence, note, zagnieżdżona scena) -
 * strukturalnie zgodny zarówno z `ServerBlock`'s wariantem SCENE_HOTSPOTS (blocks.ts), jak i z luźno typowanym `Block`
 * w apps/api (evaluate.ts, client-view.ts), które NIE importują pełnych typów zod (unikają zależności od `zod` w API).
 */
export interface HotspotLike {
  id: string;
  required?: boolean;
  evidence?: boolean;
  note?: { text: string; kind?: string };
  media?: { kind?: string; scene?: { hotspots?: readonly HotspotLike[] } };
}

/**
 * Spłaszcza hotspoty SCENE_HOTSPOTS (zewnętrzne + WEWNĘTRZNE z `media.kind: 'scene'`, B-086/D-071) do JEDNEJ listy -
 * DZIELONA definicja między walidacją modułu (poniżej) a apps/api (liczenie dowodów, walidacja `visited`/`noted`):
 * jedno miejsce decyduje, co się liczy, żeby te dwie strony nigdy nie rozjechały się w tym, co uznają za "ten sam zbiór".
 * Zawsze dokładnie jeden poziom (innerHotspotSchema nie ma już własnego `media.kind: 'scene'`), więc bez rekurencji.
 */
export function flattenHotspots(hotspots: readonly HotspotLike[]): HotspotLike[] {
  return hotspots.flatMap((h) => [h, ...(h.media?.kind === 'scene' ? (h.media.scene?.hotspots ?? []) : [])]);
}

/**
 * Notatka i dowód. Dowód (evidence: true) musi mieć `note`. Od schemaVersion 3 KAŻDA notatka ma `kind` (ikona w notatniku; jedna reguła
 * zamiast "kind tylko przy dowodzie"); moduły w wersji 2 nie mają tego pola, więc są zwolnione.
 */
function evidenceErrors(
  label: string,
  item: { evidence?: boolean; note?: { text: string; kind?: string } },
  kindRequired: boolean,
): string[] {
  const errors: string[] = [];
  if (item.evidence === true && !item.note) errors.push(`${label}: evidence wymaga pola note`);
  if (item.note && !item.note.kind && kindRequired) errors.push(`${label}: note wymaga note.kind (ikona w notatniku)`);
  return errors;
}

/**
 * Kotwice kryteriów w makiecie maila (criteria[].target): spójność z treścią maila. link -> linkId istnieje w email.links (bez quote);
 * text -> quote jest fragmentem email.body (bez linkId); attachment -> mail ma załącznik; sender i subject bez dodatkowych pól;
 * dwa kryteria nie mogą mieć tej samej kotwicy (kliknięcie fragmentu zaznacza dokładnie jedno kryterium).
 */
function emailTargetErrors(block: Extract<ServerBlock, { type: 'EMAIL_ANALYSIS' }>): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  block.criteria.forEach((c, i) => {
    const t = c.target;
    if (!t) return;
    const label = `criteria[${i}].target`;
    if (t.kind === 'link') {
      if (!t.linkId || !block.email.links.some((l) => l.id === t.linkId)) errors.push(`${label}: link wymaga linkId istniejącego w email.links`);
      if (t.quote !== undefined) errors.push(`${label}: link nie ma quote`);
    } else if (t.kind === 'text') {
      if (!t.quote || !t.quote.trim() || !block.email.body.includes(t.quote)) errors.push(`${label}: quote musi być fragmentem email.body`);
      if (t.linkId !== undefined) errors.push(`${label}: text nie ma linkId`);
    } else {
      if (t.linkId !== undefined || t.quote !== undefined) errors.push(`${label}: ${t.kind} nie ma linkId ani quote`);
      if (t.kind === 'attachment' && !block.email.attachment) errors.push(`${label}: attachment wymaga email.attachment`);
    }
    const key = `${t.kind}:${t.linkId ?? ''}:${t.quote ?? ''}`;
    if (seen.has(key)) errors.push(`${label}: ta sama kotwica jest już użyta przez inne kryterium`);
    seen.add(key);
  });
  return errors;
}

/** `required` jawnie ustawione co najmniej na jednym elemencie musi zostawiać co najmniej jeden element wymagany (przy obu sposobach wygrywa `required`). */
function checkRequiredFlags(label: string, items: { required?: boolean }[], errors: string[]) {
  if (!items.some((item) => item.required !== undefined)) return;
  if (!items.some((item) => item.required === true)) errors.push(`${label}: co najmniej jeden element musi mieć required: true`);
}

// Pola dostępne dopiero od schemaVersion 3 (moduł w wersji 2 ich nie używa). Ścieżki względem bloku: `a.b`, `a[].b`.
const V3_FEATURES = ['hotspots[].evidence', 'hotspots[].note', 'hotspots[].required', 'questions[].evidence', 'questions[].required',
  'questions[].lines', 'questions[].note.kind', 'character.avatar', 'criteria[].evidence', 'criteria[].note.kind', 'criteria[].target', 'email.date', 'email.attachment'];

// Pola dostępne dopiero od schemaVersion 4 (poziom bloku; metadane modułu - subtitle/level/objectives - i blok NARRATIVE mają
// osobne sprawdzenie w parseModule, bo nie są ścieżkami WEWNĄTRZ bloku). `hotspots[].media` obejmuje też zagnieżdżoną
// scenę (każda ścieżka `hotspots[].media.scene.hotspots[].*` zaczyna się od tego samego prefiksu - jeden wpis wystarcza,
// featuresUsed dopasowuje po prefiksie, nie dokładnym stringu).
const V4_FEATURES = ['character.opening', 'reactions.complete', 'reactions.result', 'email.to', 'hotspots[].action', 'hotspots[].media'];

function featuresUsed(block: ServerBlock, features: string[]): string[] {
  const paths = new Set(collectPaths(block));
  return features.filter((feature) => [...paths].some((path) => path === feature || path.startsWith(`${feature}.`) || path.startsWith(`${feature}[]`)));
}

/** Pola z wersji 3 użyte w bloku (do sprawdzenia względem deklarowanego schemaVersion). */
export function v3FeaturesUsed(block: ServerBlock): string[] {
  return featuresUsed(block, V3_FEATURES);
}

/** Pola z wersji 4 użyte w bloku. */
export function v4FeaturesUsed(block: ServerBlock): string[] {
  return featuresUsed(block, V4_FEATURES);
}

// Typy bloków, których wynik jest wyliczany 0-1 (evaluate.ts) - jedyne, którym wolno mieć `reactions.result`. Pozostałe typy
// (eksploracyjne, VIDEO, NARRATIVE...) nie mają wyniku do progowania; dla nich zostaje wyłącznie `reactions.complete`.
// Eksportowane: apps/api (evaluate.ts, pickReaction) wybiera pasujący wpis reactions.result tą samą regułą, którą tu walidujemy.
export const SCORED_BLOCK_TYPES = ['QUIZ', 'BRANCHING_SCENARIO', 'EMAIL_ANALYSIS', 'ORDERING', 'TEXT_INPUT_GUIDED'] as const;
// TEXT_INPUT_GUIDED: wynik binarny (poprawnie / po wyczerpaniu prób) - reakcje po `when`. Reszta: wynik 0-1 - reakcje po `minScore`.
export const WHEN_BASED_TYPES = new Set<string>(['TEXT_INPUT_GUIDED']);

/**
 * `reactions.result` (schemaVersion 4): tylko na blokach ocenianych (SCORED_BLOCK_TYPES); TEXT_INPUT_GUIDED używa `when`
 * (co najwyżej jeden wpis 'correct' i jeden 'incorrect'), reszta `minScore` (malejąco, bez duplikatów - pierwszy pasujący wpis
 * wygrywa, więc rosnąca/płaska lista uczyniłaby dalsze wpisy nieosiągalnymi).
 */
function reactionErrors(block: ServerBlock): string[] {
  const result = block.reactions?.result;
  if (!result) return [];
  const errors: string[] = [];
  if (!(SCORED_BLOCK_TYPES as readonly string[]).includes(block.type)) {
    errors.push(`reactions.result: nieprawidłowe dla bloku typu ${block.type} (brak wyniku 0-1 do progowania)`);
    return errors;
  }
  if (WHEN_BASED_TYPES.has(block.type)) {
    result.forEach((entry, i) => {
      if (entry.when === undefined) errors.push(`reactions.result[${i}]: dla TEXT_INPUT_GUIDED każdy wpis musi mieć "when"`);
    });
    const whens = result.map((entry) => entry.when).filter((w): w is 'correct' | 'incorrect' => w !== undefined);
    for (const dup of duplicates(whens)) errors.push(`reactions.result: powtórzone "when": "${dup}"`);
  } else {
    result.forEach((entry, i) => {
      if (entry.minScore === undefined) errors.push(`reactions.result[${i}]: dla ${block.type} każdy wpis musi mieć "minScore"`);
    });
    // Indeksy ORYGINALNE z result[] (nie skondensowanej listy samych minScore) - komunikat ma wskazywać prawdziwą pozycję
    // wpisu, także gdy któryś wcześniejszy wpis nie miał minScore wcale (błąd wyżej).
    const scores = result.map((entry, i) => [i, entry.minScore] as const).filter((pair): pair is [number, number] => pair[1] !== undefined);
    for (let k = 1; k < scores.length; k += 1) {
      const [i, score] = scores[k];
      if (score >= scores[k - 1][1]) errors.push(`reactions.result[${i}]: lista minScore musi być malejąca (pierwszy pasujący wpis wygrywa)`);
    }
  }
  return errors;
}

/** Zwraca listę błędów semantycznych bloku (pusta = OK). */
export function validateBlockSemantics(block: ServerBlock, schemaVersion: number = MODULE_SCHEMA_VERSION): string[] {
  const errors: string[] = [...reactionErrors(block)];
  const kindRequired = schemaVersion >= 3;
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
      // Id i required liczone na SPŁASZCZONEJ liście (ta sama funkcja co apps/api - flattenHotspots wyżej w tym pliku).
      const outerIds = block.hotspots.map((h) => h.id);
      checkUnique('hotspots', flattenHotspots(block.hotspots).map((h) => h.id));
      checkSubset('requiredHotspots', block.requiredHotspots, outerIds); // lista jest PRZESTARZAŁA i starsza niż zagnieżdżanie: tylko zewnętrzne.
      block.hotspots.forEach((h, i) => {
        if (h.x + h.width > 100 || h.y + h.height > 100) errors.push(`hotspots[${i}]: obszar wychodzi poza obraz`);
        if (h.action === 'next') {
          // "Drzwi": klik kończy blok jak przycisk "Dalej" - nigdy nie otwiera karty, więc content/media/evidence/note
          // byłyby martwą konfiguracją (autor mógłby pomyśleć, że działają).
          if (h.content !== undefined || h.media !== undefined || h.evidence !== undefined || h.note !== undefined) {
            errors.push(`hotspots[${i}]: action "next" (drzwi) nie może mieć content, media, evidence ani note`);
          }
        } else {
          if (h.content === undefined) errors.push(`hotspots[${i}]: content jest wymagane (chyba że action: "next")`);
          errors.push(...evidenceErrors(`hotspots[${i}]`, h, kindRequired));
        }
        if (h.media?.kind === 'scene') {
          h.media.scene.hotspots.forEach((ih, j) => {
            const label = `hotspots[${i}].media.scene.hotspots[${j}]`;
            if (ih.x + ih.width > 100 || ih.y + ih.height > 100) errors.push(`${label}: obszar wychodzi poza obraz`);
            errors.push(...evidenceErrors(label, ih, kindRequired));
          });
        }
      });
      checkRequiredFlags('hotspots', flattenHotspots(block.hotspots), errors);
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
        errors.push(...evidenceErrors(`questions[${i}]`, q, kindRequired));
      });
      checkRequiredFlags('questions', block.questions, errors);
      break;
    }
    case 'EMAIL_ANALYSIS': {
      checkUnique('criteria', block.criteria.map((c) => c.id));
      checkUnique('email.links', block.email.links.map((l) => l.id));
      block.criteria.forEach((c, i) => {
        errors.push(...evidenceErrors(`criteria[${i}]`, c, kindRequired));
        if (c.evidence === true && c.correct !== true) errors.push(`criteria[${i}]: dowodem może być tylko kryterium poprawne (correct: true)`);
      });
      errors.push(...emailTargetErrors(block));
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
        if (h.media?.kind === 'scene') {
          h.media.scene.hotspots.forEach((ih, j) => {
            if (ih.note && ih.evidence !== true) {
              warnings.push(`${where}: hotspots[${i}].media.scene.hotspots[${j}].note bez evidence: true nigdy nie trafi do notatnika`);
            }
          });
        }
        if (h.note && h.evidence !== true) warnings.push(`${where}: hotspots[${i}].note bez evidence: true nigdy nie trafi do notatnika`);
      });
    }
    if (block.type === 'EMAIL_ANALYSIS') {
      const anchored = block.criteria.filter((c) => c.target);
      // Klikalne fragmenty tylko przy poprawnych kryteriach zdradzają odpowiedź (D-056): kotwice mają mieć też kryteria błędne.
      if (anchored.length > 0 && anchored.every((c) => c.correct === true)) {
        warnings.push(`${where}: wszystkie kryteria z target są poprawne: klikalność fragmentów zdradza odpowiedź (dodaj kotwice kryteriom błędnym)`);
      }
      block.criteria.forEach((c, i) => {
        const quote = c.target?.kind === 'text' ? c.target.quote : undefined;
        if (quote && block.email.body.split(quote).length > 2) {
          warnings.push(`${where}: criteria[${i}].target.quote występuje w treści więcej niż raz (podświetlone zostanie pierwsze wystąpienie)`);
        }
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
    for (const error of validateBlockSemantics(block, contentModule.schemaVersion)) errors.push(`blocks[${index}] (${block.id}): ${error}`);
    if (contentModule.schemaVersion < 3) {
      for (const feature of v3FeaturesUsed(block)) {
        errors.push(`blocks[${index}] (${block.id}): pole ${feature} wymaga schemaVersion 3`);
      }
    }
    if (contentModule.schemaVersion < 4) {
      if (block.type === 'NARRATIVE') errors.push(`blocks[${index}] (${block.id}): blok NARRATIVE wymaga schemaVersion 4`);
      for (const feature of v4FeaturesUsed(block)) {
        errors.push(`blocks[${index}] (${block.id}): pole ${feature} wymaga schemaVersion 4`);
      }
    }
  });

  // Metadane modułu z wersji 4 (nie są ścieżką WEWNĄTRZ bloku, więc osobne sprawdzenie od v3FeaturesUsed/v4FeaturesUsed).
  if (contentModule.schemaVersion < 4) {
    if (contentModule.subtitle !== undefined) errors.push('subtitle: wymaga schemaVersion 4');
    if (contentModule.level !== undefined) errors.push('level: wymaga schemaVersion 4');
    if (contentModule.objectives !== undefined) errors.push('objectives: wymaga schemaVersion 4');
  }

  const summaries = contentModule.blocks.map((b, i) => (b.type === 'SUMMARY' ? i : -1)).filter((i) => i >= 0);
  if (summaries.length > 1) errors.push('SUMMARY: co najwyżej jeden blok podsumowania');
  if (summaries.length === 1 && summaries[0] !== contentModule.blocks.length - 1) {
    errors.push('SUMMARY: blok podsumowania musi być ostatni');
  }

  if (errors.length > 0) throw new ContentValidationError(errors);
  return contentModule;
}
