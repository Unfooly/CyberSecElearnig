import type { Alignment, SynthesisRequest, SynthesisResult, TtsProvider } from '../types.js';

// Klient ElevenLabs (text-to-speech z timestampami): POST /v1/text-to-speech/{voice_id}/with-timestamps zwraca JSON z nagraniem (base64) i
// `alignment` (czasy znaków). Klucz API jest SEKRETEM autora (.env.local): trafia wyłącznie do nagłówka `xi-api-key`, nigdy do logów ani
// komunikatów błędów (redact). Sieć siedzi za wstrzykiwanym `fetch`, więc testy i CI nie wołają ElevenLabs.

export const DEFAULT_MODEL = 'eleven_multilingual_v2';
export const DEFAULT_LANGUAGE = 'pl';
const OUTPUT_FORMAT = 'mp3_44100_128';
/** Limit znaków jednego żądania (model multilingual v2 przyjmuje do 10 000; narracje w modułach mają <= 4000). */
export const MAX_TEXT_CHARS = 10_000;

/**
 * `language_code` (wymuszenie języka) obsługują tylko modele Turbo/Flash v2.5; eleven_multilingual_v2 wykrywa język z tekstu i odrzuciłby
 * nieznany parametr. Język jest mimo to częścią skrótu nazwy pliku (hash.ts) i konfiguracji, więc zmiana języka daje nowe nagranie.
 */
const LANGUAGE_CODE_MODELS = new Set(['eleven_turbo_v2_5', 'eleven_flash_v2_5']);

const VOICE_ID = /^[A-Za-z0-9_-]{6,64}$/;

export interface ElevenLabsOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Liczba PONOWIEŃ po pierwszej próbie (429, 5xx, błąd sieci). */
  maxRetries?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Dodatkowe maskowanie sekretów w komunikatach błędów (stosowane PO domyślnym maskowaniu klucza, nie zamiast niego). */
  redact?: (text: string) => string;
  /** Tylko testy: pozwala na adres API inny niż https://api.elevenlabs.io. */
  allowAnyBaseUrl?: boolean;
}

class NonRetryableError extends Error {}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Opis liczby wykonanych prób w komunikacie końcowym (przy przekroczeniach czasu ponawiamy najwyżej raz, więc bywa mniej niż maxRetries + 1). */
const attemptsMade = (maxRetries: number, timeouts: number) => (timeouts > 1 ? `po ${timeouts} przekroczeniach czasu` : `${maxRetries + 1} prób`);

/** Krótki fragment odpowiedzi z błędem (po zamaskowaniu): API zwraca `detail.message` albo `detail` jako tekst. */
function errorDetail(body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  const message = typeof detail === 'string' ? detail : (detail as { message?: unknown } | undefined)?.message;
  // Bez znaków sterujących (sekwencje escape terminala w tekście od serwera) i najwyżej 200 znaków.
  return typeof message === 'string' ? message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200) : '';
}

function isMp3(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33; // "ID3"
  // Synchronizacja ramki MPEG audio Layer III (0xFF 0xFB/0xF3/0xE3...): maska 0xE6 odrzuca m.in. AAC (ADTS), który też zaczyna się od 0xFF 0xF.
  const frame = bytes[0] === 0xff && (bytes[1] & 0xe6) === 0xe2;
  return id3 || frame;
}

/** Górny limit rozmiaru nagrania (zgodny z limitem audio w repo dla trybu local); base64 to ~4/3 rozmiaru. */
export const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const MAX_AUDIO_BASE64_CHARS = Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 8;
/** Alignment ma po jednym wpisie na znak tekstu, więc nie może być większy niż tekst (limit żądania) z zapasem na normalizację. */
const MAX_ALIGNMENT_ENTRIES = MAX_TEXT_CHARS * 2;

/** Cały adres bazowy API musi być https i hostem api.elevenlabs.io: klucz jest wysyłany w nagłówku pod ten adres. */
function assertBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('Niepoprawny adres API ElevenLabs.');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'api.elevenlabs.io' || url.username || url.password) {
    throw new Error('Adres API musi być https://api.elevenlabs.io (klucz API nie może trafić pod inny host).');
  }
  return baseUrl.replace(/\/+$/, '');
}

function parseAlignment(raw: unknown): Alignment {
  const a = raw as { characters?: unknown; character_start_times_seconds?: unknown; character_end_times_seconds?: unknown } | null;
  const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
  const isNumbers = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0);
  if (!a || !isStrings(a.characters) || !isNumbers(a.character_start_times_seconds) || !isNumbers(a.character_end_times_seconds)) {
    throw new Error('Odpowiedź ElevenLabs nie zawiera poprawnego alignment (czasów znaków).');
  }
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = a;
  if (characters.length !== starts.length || characters.length !== ends.length || characters.length === 0 || characters.length > MAX_ALIGNMENT_ENTRIES) {
    throw new Error('Odpowiedź ElevenLabs: alignment ma niespójne albo zbyt duże tablice.');
  }
  if (ends.some((end, i) => end < starts[i])) throw new Error('Odpowiedź ElevenLabs: alignment ma koniec znaku przed jego początkiem.');
  return { characters, characterStartTimesSeconds: starts, characterEndTimesSeconds: ends };
}

export class ElevenLabsProvider implements TtsProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly redact: (text: string) => string;
  private readonly apiKey: string;

  constructor(options: ElevenLabsOptions) {
    if (!options.apiKey) throw new Error('Brak ELEVENLABS_API_KEY.');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    const baseUrl = options.baseUrl ?? 'https://api.elevenlabs.io';
    this.baseUrl = options.allowAnyBaseUrl ? baseUrl.replace(/\/+$/, '') : assertBaseUrl(baseUrl);
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.sleep = options.sleep ?? wait;
    const extra = options.redact ?? ((text: string) => text);
    // Domyślne maskowanie klucza ZAWSZE działa; opcjonalny redact dokłada własne reguły.
    this.redact = (text) => extra(text.split(options.apiKey).join('***'));
  }

  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    if (!VOICE_ID.test(request.voiceId)) throw new Error('Niepoprawny voiceId (scripts/content/voices.json, VOICE_ID).');
    if (request.text.trim() === '') throw new Error('Pusty tekst narracji.');
    if (request.text.length > MAX_TEXT_CHARS) throw new Error(`Tekst narracji ma ${request.text.length} znaków (limit żądania: ${MAX_TEXT_CHARS}).`);

    const url = `${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(request.voiceId)}/with-timestamps?output_format=${OUTPUT_FORMAT}`;
    const body = JSON.stringify({
      text: request.text,
      model_id: request.model,
      ...(LANGUAGE_CODE_MODELS.has(request.model) ? { language_code: request.language } : {}),
    });

    let lastError: unknown;
    let timeouts = 0;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.once(url, body);
      } catch (error) {
        if (error instanceof NonRetryableError) throw new Error(this.redact(error.message));
        lastError = error;
        // Po przekroczeniu czasu serwer mógł już przetworzyć żądanie (rozliczenie znaków): ponawiamy najwyżej RAZ.
        if ((error as { isTimeout?: boolean }).isTimeout) timeouts += 1;
        if (attempt === this.maxRetries || timeouts > 1) break;
        const retryAfter = (error as { retryAfterMs?: number }).retryAfterMs;
        await this.sleep(retryAfter ?? Math.min(30_000, 1000 * 2 ** attempt)); // 1 s, 2 s, 4 s, ...
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(this.redact(`ElevenLabs: nieudane próby (${attemptsMade(this.maxRetries, timeouts)}). Ostatni błąd: ${message}`));
  }

  /** Jedna próba. Limit czasu obejmuje CAŁĄ odpowiedź (nagłówki i ciało): zawieszone ciało nie wiesza potoku. */
  private async once(url: string, body: string): Promise<SynthesisResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
          body,
          signal: controller.signal,
          // Klucz jest w nagłówku niestandardowym (xi-api-key), którego fetch NIE usuwa przy przekierowaniu na inny origin: żadnych redirectów.
          redirect: 'error',
        });
      } catch (error) {
        throw this.transportError(error, controller);
      }
      return await this.handle(response, controller);
    } finally {
      clearTimeout(timer);
    }
  }

  private transportError(error: unknown, controller: AbortController): Error {
    if (controller.signal.aborted) return Object.assign(new Error(`przekroczono czas ${this.timeoutMs} ms`), { isTimeout: true });
    return new Error(`błąd sieci: ${(error as Error).message}`);
  }

  private async readJson(response: Response, controller: AbortController): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw this.transportError(error, controller);
      return null;
    }
  }

  private async handle(response: Response, controller: AbortController): Promise<SynthesisResult> {
    if (!response.ok) {
      const detail = errorDetail(await this.readJson(response, controller));
      const suffix = detail ? ` (${detail})` : '';
      if (response.status === 401 || response.status === 403) {
        throw new NonRetryableError(`ElevenLabs ${response.status}: odmowa dostępu (sprawdź ELEVENLABS_API_KEY i uprawnienia)${suffix}.`);
      }
      if (response.status === 429 || response.status >= 500) {
        const header = Number(response.headers.get('retry-after'));
        const retryAfterMs = Number.isFinite(header) && header > 0 ? Math.min(header, 120) * 1000 : undefined;
        throw Object.assign(new Error(`HTTP ${response.status}${suffix}`), { retryAfterMs });
      }
      throw new NonRetryableError(`ElevenLabs ${response.status}: żądanie odrzucone${suffix}.`);
    }

    // Odpowiedź o deklarowanym rozmiarze ponad limit odrzucamy bez czytania ciała (pamięć).
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_AUDIO_BASE64_CHARS * 2) {
      throw new NonRetryableError('Odpowiedź ElevenLabs jest zbyt duża.');
    }
    const json = (await this.readJson(response, controller)) as { audio_base64?: unknown; alignment?: unknown } | null;
    if (!json || typeof json.audio_base64 !== 'string' || json.audio_base64 === '') {
      throw new NonRetryableError('Odpowiedź ElevenLabs nie zawiera nagrania (audio_base64).');
    }
    if (json.audio_base64.length > MAX_AUDIO_BASE64_CHARS) {
      throw new NonRetryableError(`Nagranie przekracza ${MAX_AUDIO_BYTES / 1024 / 1024} MB: skróć narrację.`);
    }
    const audio = new Uint8Array(Buffer.from(json.audio_base64, 'base64'));
    if (!isMp3(audio)) throw new NonRetryableError('Odpowiedź ElevenLabs nie jest nagraniem mp3.');
    let alignment: Alignment;
    try {
      alignment = parseAlignment(json.alignment);
    } catch (error) {
      throw new NonRetryableError((error as Error).message);
    }
    return { audio, alignment };
  }
}
