import { redactSecrets, requireVars, type Config } from '../env.js';
import type { ObjectHead, ObjectStore, PutOptions } from '../types.js';
import { assertSafeKey } from './key.js';

// Magazyn w Cloudflare R2 (API zgodne z S3). Klucze dostępu są WYŁĄCZNIE w lokalnym .env.local autora (D-060); token ma uprawnienie Object
// Read & Write ograniczone do jednego bucketa. Używamy tylko HEAD, GET i PUT: nigdy DELETE, więc żaden błąd skryptu nie usunie obiektów.
// Zapis bez nadpisania: HEAD przed PUT (jeden autor, brak wyścigu); nie polegamy na warunkowym PUT (If-None-Match), którego obsługi przez R2
// nie zakładamy.

/** Minimalny kształt klienta S3, którego używamy (SDK: S3Client.send); w testach podstawiany fake, więc zero sieci. */
export interface S3Like {
  send(command: unknown): Promise<any>;
}

/** Konstruktory komend SDK; wstrzykiwane, żeby SDK (duży) ładował się tylko dla --storage r2. */
export interface S3Commands {
  HeadObjectCommand: new (input: any) => unknown;
  GetObjectCommand: new (input: any) => unknown;
  PutObjectCommand: new (input: any) => unknown;
}

export class R2Store implements ObjectStore {
  constructor(
    private readonly client: S3Like,
    private readonly bucket: string,
    private readonly commands: S3Commands,
    /** Maskowanie sekretów w komunikatach błędów z SDK (klucze nie mogą trafić do logów). WYMAGANE: brak domyślnej funkcji tożsamościowej. */
    private readonly redact: (text: string) => string,
  ) {}

  private fail(operation: string, key: string, error: unknown): never {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(this.redact(`R2 ${operation} ${key}: ${message}`));
  }

  private isNotFound(error: unknown): boolean {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
  }

  async head(key: string): Promise<ObjectHead | null> {
    assertSafeKey(key);
    try {
      const result = await this.client.send(new this.commands.HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      const etag = typeof result?.ETag === 'string' ? result.ETag.replace(/"/g, '') : '';
      // ETag jednoczęściowego zapisu to MD5; przy multipart zawiera "-" (nie jest MD5).
      return { size: Number(result?.ContentLength ?? 0), md5: /^[0-9a-f]{32}$/i.test(etag) ? etag.toLowerCase() : null };
    } catch (error) {
      if (this.isNotFound(error)) return null;
      return this.fail('HEAD', key, error);
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertSafeKey(key);
    try {
      const result = await this.client.send(new this.commands.GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return await result.Body.transformToByteArray();
    } catch (error) {
      if (this.isNotFound(error)) return null;
      return this.fail('GET', key, error);
    }
  }

  async put(key: string, body: Uint8Array, options: PutOptions, overwrite = false): Promise<boolean> {
    assertSafeKey(key);
    if (!overwrite && (await this.head(key)) !== null) return false;
    try {
      await this.client.send(
        new this.commands.PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentLength: body.byteLength,
          ContentType: options.contentType,
          CacheControl: options.cacheControl,
        }),
      );
      return true;
    } catch (error) {
      // 412 (gdyby serwer egzekwował warunek): obiekt już istnieje, nic nie zapisano.
      if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 412) return false;
      return this.fail('PUT', key, error);
    }
  }
}

/** Ładowanie SDK; podmieniane w testach (bez importu prawdziwego @aws-sdk/client-s3 i bez sieci). */
export interface SdkModule extends S3Commands {
  S3Client: new (config: any) => S3Like;
}
export type SdkLoader = () => Promise<SdkModule>;

const defaultSdkLoader: SdkLoader = async () => (await import('@aws-sdk/client-s3')) as unknown as SdkModule;

/**
 * Buduje magazyn R2 z konfiguracji (.env.local). Endpoint musi być https bez ścieżki (bucket przekazujemy osobno: forcePathStyle), region
 * to "auto" (R2). Wymaga kompletu zmiennych R2_*; brak = błąd z LISTĄ NAZW.
 */
export async function createR2Store(
  config: Config,
  loadSdk: SdkLoader = defaultSdkLoader,
  /** Tylko testy: pozwala na endpoint spoza *.r2.cloudflarestorage.com. */
  options: { allowAnyHost?: boolean } = {},
): Promise<R2Store> {
  requireVars(config, ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']);
  let endpoint: URL;
  try {
    endpoint = new URL(config.R2_ENDPOINT!);
  } catch {
    throw new Error('R2_ENDPOINT nie jest poprawnym adresem URL.');
  }
  if (endpoint.protocol !== 'https:' || (endpoint.pathname !== '/' && endpoint.pathname !== '') || endpoint.username || endpoint.password) {
    throw new Error('R2_ENDPOINT musi być adresem https bez ścieżki i danych logowania (np. https://<konto>.r2.cloudflarestorage.com).');
  }
  // Podpisane żądania niosą identyfikator klucza dostępu, nazwę bucketa, klucze i treść zapisu: literówka albo obcy wpis w .env.local nie może
  // skierować ich pod obcy host. Endpoint R2 (także warianty jurysdykcji: .eu., .fedramp.) zawsze kończy się na .r2.cloudflarestorage.com.
  if (!options.allowAnyHost && !endpoint.hostname.toLowerCase().endsWith('.r2.cloudflarestorage.com')) {
    throw new Error('R2_ENDPOINT musi wskazywać host *.r2.cloudflarestorage.com (endpoint S3 Cloudflare R2).');
  }
  const sdk = await loadSdk();
  const client = new sdk.S3Client({
    region: 'auto',
    endpoint: endpoint.origin,
    forcePathStyle: true,
    credentials: { accessKeyId: config.R2_ACCESS_KEY_ID!, secretAccessKey: config.R2_SECRET_ACCESS_KEY! },
  });
  return new R2Store(client, config.R2_BUCKET!, sdk, (text) => redactSecrets(text, config));
}
