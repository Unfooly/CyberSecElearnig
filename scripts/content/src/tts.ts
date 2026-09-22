import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertNotCi, readEnvFile, redactSecrets, requireVars, resolveConfig, type Config } from './env.js';
import { runAssetsPipeline } from './assets.js';
import { assertSlug, assertVersion } from './hash.js';
import { runPipeline } from './pipeline.js';
import { DEFAULT_MAX_CHARS } from './plan.js';
import { DEFAULT_LANGUAGE, DEFAULT_MODEL, ElevenLabsProvider } from './providers/elevenlabs.js';
import { LocalStore } from './stores/local.js';
import { createR2Store } from './stores/r2.js';
import type { ObjectStore } from './types.js';

// Użycie: npm run tts --prefix scripts/content -- <slug> [--storage local|r2] [--version v1] [--only blockId,...] [--max-chars 20000]
//                                                    [--yes] [--dry-run] [--check] [--assets]
// Klucze tylko w scripts/content/.env.local (poza gitem, CI i kontenerami). --check i --dry-run działają bez kluczy i bez sieci.
// --assets: osobny tryb (bez ElevenLabs) - publikuje obrazy/avatary z packages/content/modules/<slug>/assets/ zamiast generować audio.

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');

const USAGE = `Użycie: npm run tts --prefix scripts/content -- <slug> [opcje]
  --storage local|r2   gdzie zapisać nagrania (domyślnie local: apps/web/public/content)
  --version <v>        wersja partii audio w kluczu pliku (domyślnie v1)
  --only <id,id>       tylko wskazane bloki
  --max-chars <n>      limit znaków do wygenerowania w jednym przebiegu (domyślnie ${DEFAULT_MAX_CHARS})
  --yes                bez pytania o potwierdzenie
  --dry-run            tylko plan (bez sieci, kluczy i zapisów)
  --check              offline: czy nagrania/zasoby odpowiadają aktualnej treści (bez kluczy i sieci)
  --assets             publikuj zasoby modułu (obrazy, avatary) zamiast generować audio; nie wymaga ELEVENLABS_*`;

/** Kody wyjścia: 0 = OK, 1 = błąd wykonania albo --check wykrył problemy, 2 = błędne użycie (argumenty). */
export async function main(argv: string[], processEnv: NodeJS.ProcessEnv = process.env): Promise<number> {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    console.error(`Błąd: ${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  if (parsed === 'help') {
    console.log(USAGE);
    return 0;
  }
  return execute(parsed, processEnv);
}

interface Parsed {
  slug: string;
  version: string;
  storage: 'local' | 'r2';
  maxChars: number;
  only?: string[];
  yes: boolean;
  dryRun: boolean;
  check: boolean;
  assets: boolean;
}

function parseArguments(argv: string[]): Parsed | 'help' {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      storage: { type: 'string', default: 'local' },
      version: { type: 'string', default: 'v1' },
      only: { type: 'string' },
      'max-chars': { type: 'string', default: String(DEFAULT_MAX_CHARS) },
      yes: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      assets: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) return 'help';
  if (positionals.length !== 1) throw new Error('Podaj dokładnie jeden slug modułu.');
  if (values.storage !== 'local' && values.storage !== 'r2') throw new Error('--storage: local albo r2.');
  return {
    slug: assertSlug(positionals[0]),
    version: assertVersion(values.version!),
    storage: values.storage,
    maxChars: Number(values['max-chars']),
    only: values.only ? values.only.split(',').map((id) => id.trim()).filter(Boolean) : undefined,
    yes: values.yes!,
    dryRun: values['dry-run']!,
    check: values.check!,
    assets: values.assets!,
  };
}

async function execute(args: Parsed, processEnv: NodeJS.ProcessEnv): Promise<number> {
  const offline = args.check || args.dryRun;
  // Config (i .env.local) tylko dla trybów z siecią/kluczami; --check i --dry-run go nie czytają i działają w CI.
  let config: Config = {};
  const redact = (text: string) => redactSecrets(text, config);
  try {
    if (!offline) {
      assertNotCi(processEnv);
      config = resolveConfig(readEnvFile(join(PACKAGE_ROOT, '.env.local')), processEnv);
    }
    let store: ObjectStore;
    if (args.storage === 'r2' && !offline) store = await createR2Store(config);
    else store = new LocalStore(join(REPO_ROOT, 'apps', 'web', 'public', 'content'));

    if (args.assets) {
      const result = await runAssetsPipeline({
        moduleDir: join(REPO_ROOT, 'packages', 'content', 'modules', args.slug),
        store,
        dryRun: args.dryRun,
        check: args.check,
        only: args.only,
        output: process.stdout,
      });
      return result.problems.length > 0 ? 1 : 0;
    }

    let tts: ElevenLabsProvider | undefined;
    let voiceId = '';
    if (!offline) {
      requireVars(config, ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID']);
      tts = new ElevenLabsProvider({ apiKey: config.ELEVENLABS_API_KEY!, redact });
      voiceId = config.ELEVENLABS_VOICE_ID!;
    }
    const result = await runPipeline({
      moduleDir: join(REPO_ROOT, 'packages', 'content', 'modules', args.slug),
      version: args.version,
      model: DEFAULT_MODEL,
      language: DEFAULT_LANGUAGE,
      voiceId,
      store,
      tts,
      maxChars: args.maxChars,
      yes: args.yes,
      dryRun: args.dryRun,
      check: args.check,
      only: args.only,
      output: process.stdout,
    });
    return result.problems.length > 0 ? 1 : 0;
  } catch (error) {
    console.error(`Błąd: ${redact((error as Error).message)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`Błąd: ${(error as Error).message}`);
      process.exit(1);
    },
  );
}
