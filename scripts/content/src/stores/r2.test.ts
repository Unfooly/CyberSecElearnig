import { describe, expect, it, vi } from 'vitest';
import * as sdk from '@aws-sdk/client-s3';
import { createR2Store, R2Store, type S3Like, type SdkModule } from './r2.js';
import { IMMUTABLE_CACHE } from './key.js';

// Prawdziwe KLASY komend SDK (budują `input`), ale klient jest fałszywy: żadnych wywołań sieciowych.
const commands = { HeadObjectCommand: sdk.HeadObjectCommand, GetObjectCommand: sdk.GetObjectCommand, PutObjectCommand: sdk.PutObjectCommand };
const bytes = (text: string) => new TextEncoder().encode(text);
const options = { contentType: 'audio/mpeg', cacheControl: IMMUTABLE_CACHE };
const noRedact = (text: string) => text;

type Sent = { name: string; input: Record<string, unknown> };

function fakeClient(handler: (command: Sent) => unknown | Promise<unknown>): S3Like & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    async send(command: unknown) {
      const c = command as { constructor: { name: string }; input: Record<string, unknown> };
      const entry = { name: c.constructor.name, input: c.input };
      sent.push(entry);
      return handler(entry);
    },
  };
}

const notFound = () => Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });

describe('R2Store', () => {
  it('HEAD: rozmiar i md5 z ETag; multipart ETag ("-") to md5 = null; 404 to null', async () => {
    const client = fakeClient(({ input }) => {
      if (input.Key === 'k/single') return { ContentLength: 12, ETag: '"0123456789ABCDEF0123456789abcdef"' };
      if (input.Key === 'k/multi') return { ContentLength: 99, ETag: '"0123456789abcdef0123456789abcdef-3"' };
      throw notFound();
    });
    const store = new R2Store(client, 'bucket', commands, noRedact);
    expect(await store.head('k/single')).toEqual({ size: 12, md5: '0123456789abcdef0123456789abcdef' });
    expect(await store.head('k/multi')).toEqual({ size: 99, md5: null });
    expect(await store.head('k/brak')).toBeNull();
    expect(client.sent.every((entry) => entry.name === 'HeadObjectCommand' && entry.input.Bucket === 'bucket')).toBe(true);
  });

  it('GET: bajty z Body; NoSuchKey/404 to null', async () => {
    const client = fakeClient(({ input }) => {
      if (input.Key === 'k/a') return { Body: { transformToByteArray: async () => bytes('dane') } };
      throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    });
    const store = new R2Store(client, 'bucket', commands, noRedact);
    expect(new TextDecoder().decode((await store.get('k/a'))!)).toBe('dane');
    expect(await store.get('k/b')).toBeNull();
  });

  it('PUT: Bucket, Key, ContentType, CacheControl, ContentLength; nowy obiekt = HEAD potem PUT, bez warunkowych nagłówków i bez DELETE', async () => {
    const client = fakeClient(({ name }) => {
      if (name === 'HeadObjectCommand') throw notFound();
      return {};
    });
    const store = new R2Store(client, 'unfooly-content', commands, noRedact);
    expect(await store.put('audio/m/v1/a/0123456789abcdef.mp3', bytes('mp3'), options)).toBe(true);

    expect(client.sent.map((entry) => entry.name)).toEqual(['HeadObjectCommand', 'PutObjectCommand']);
    expect(client.sent[1].input).toEqual({
      Bucket: 'unfooly-content',
      Key: 'audio/m/v1/a/0123456789abcdef.mp3',
      Body: bytes('mp3'),
      ContentLength: 3,
      ContentType: 'audio/mpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    });
    expect(client.sent.some((entry) => /Delete/.test(entry.name))).toBe(false);
    expect(Object.keys(client.sent[1].input).some((key) => /^If/.test(key))).toBe(false);
  });

  it('PUT bez overwrite dla istniejącego obiektu: false i NIC nie jest wysyłane poza HEAD; z overwrite: sam PUT', async () => {
    const client = fakeClient(() => ({ ContentLength: 3, ETag: '"0123456789abcdef0123456789abcdef"' }));
    const store = new R2Store(client, 'b', commands, noRedact);
    expect(await store.put('k/a', bytes('x'), options)).toBe(false);
    expect(client.sent.map((entry) => entry.name)).toEqual(['HeadObjectCommand']);

    client.sent.length = 0;
    expect(await store.put('k/a', bytes('x'), options, true)).toBe(true);
    expect(client.sent.map((entry) => entry.name)).toEqual(['PutObjectCommand']);
  });

  it('PUT: 412 (gdyby serwer egzekwował warunek) to false, nie błąd', async () => {
    const client = fakeClient(({ name }) => {
      if (name === 'HeadObjectCommand') throw notFound();
      throw Object.assign(new Error('PreconditionFailed'), { $metadata: { httpStatusCode: 412 } });
    });
    expect(await new R2Store(client, 'b', commands, noRedact).put('k/a', bytes('x'), options)).toBe(false);
  });

  it('błędy SDK: komunikat z operacją i kluczem, sekrety zamaskowane, bez oryginalnego błędu w łańcuchu', async () => {
    const client = fakeClient(() => {
      throw new Error('AccessDenied dla AKIA-SEKRET-XYZ / tajny+sekret/klucz');
    });
    const store = new R2Store(client, 'b', commands, (text) => text.replace('AKIA-SEKRET-XYZ', '***').replace('tajny+sekret/klucz', '***'));
    const error = await store.put('k/a', bytes('x'), options, true).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('R2 PUT k/a: AccessDenied dla *** / ***');
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it.each(['../x', 'a//b', '/abs', 'a\\b'])('niebezpieczny klucz %j jest odrzucany przed wysłaniem czegokolwiek', async (key) => {
    const client = fakeClient(() => ({}));
    const store = new R2Store(client, 'b', commands, noRedact);
    await expect(store.head(key)).rejects.toThrow(/Niepoprawny klucz/);
    await expect(store.get(key)).rejects.toThrow(/Niepoprawny klucz/);
    await expect(store.put(key, bytes('x'), options)).rejects.toThrow(/Niepoprawny klucz/);
    expect(client.sent).toEqual([]);
  });
});

describe('createR2Store', () => {
  const fullConfig = {
    R2_ENDPOINT: 'https://f7b135e8cbe02c2266560186fc264b13.r2.cloudflarestorage.com',
    R2_BUCKET: 'unfooly-content',
    R2_ACCESS_KEY_ID: 'AKIA-ACCESS-1',
    R2_SECRET_ACCESS_KEY: 'super-secret-value',
  };

  function loader() {
    const constructed: unknown[] = [];
    const fake: SdkModule = {
      ...commands,
      S3Client: class {
        constructor(config: unknown) {
          constructed.push(config);
        }
        async send() {
          return {};
        }
      },
    };
    return { constructed, load: vi.fn(async () => fake) };
  }

  it('klient: region "auto", forcePathStyle, endpoint (sam origin), poświadczenia z konfiguracji', async () => {
    const { constructed, load } = loader();
    await createR2Store(fullConfig, load);
    expect(constructed).toEqual([
      {
        region: 'auto',
        endpoint: 'https://f7b135e8cbe02c2266560186fc264b13.r2.cloudflarestorage.com',
        forcePathStyle: true,
        credentials: { accessKeyId: 'AKIA-ACCESS-1', secretAccessKey: 'super-secret-value' },
      },
    ]);
  });

  it('brak zmiennych: błąd z NAZWAMI (bez wartości) i bez ładowania SDK', async () => {
    const { load } = loader();
    const error = await createR2Store({ R2_BUCKET: 'b', R2_SECRET_ACCESS_KEY: 'super-secret-value' }, load).catch((e: Error) => e);
    expect((error as Error).message).toContain('R2_ENDPOINT');
    expect((error as Error).message).toContain('R2_ACCESS_KEY_ID');
    expect((error as Error).message).not.toContain('super-secret-value');
    expect(load).not.toHaveBeenCalled();
  });

  it.each([
    ['http://x.r2.cloudflarestorage.com', /https/],
    ['https://obcy.example/', /r2\.cloudflarestorage/],
    ['https://x.r2.cloudflarestorage.com/unfooly-content', /bez ścieżki/],
    ['https://user:haslo@x.r2.cloudflarestorage.com', /bez ścieżki/],
    ['nie-url', /poprawnym adresem/],
  ])('endpoint %s jest odrzucany', async (endpoint, message) => {
    await expect(createR2Store({ ...fullConfig, R2_ENDPOINT: endpoint }, loader().load)).rejects.toThrow(message);
  });

  it.each(['https://obcy-host.example', 'https://r2.cloudflarestorage.com.evil.example', 'https://evilr2.cloudflarestorage.com.pl'])(
    'endpoint spoza *.r2.cloudflarestorage.com (%s) jest odrzucany: podpisane żądania nie trafią pod obcy host',
    async (endpoint) => {
      const { load } = loader();
      await expect(createR2Store({ ...fullConfig, R2_ENDPOINT: endpoint }, load)).rejects.toThrow(/r2\.cloudflarestorage\.com/);
      expect(load).not.toHaveBeenCalled();
    },
  );

  it.each([
    'https://f7b135e8cbe02c2266560186fc264b13.r2.cloudflarestorage.com',
    'https://f7b135e8cbe02c2266560186fc264b13.eu.r2.cloudflarestorage.com',
    'https://F7B1.R2.CloudflareStorage.com',
  ])('endpoint R2 %s (także jurysdykcje EU, wielkość liter) jest przyjmowany', async (endpoint) => {
    await expect(createR2Store({ ...fullConfig, R2_ENDPOINT: endpoint }, loader().load)).resolves.toBeInstanceOf(R2Store);
  });

  it('sekrety z konfiguracji są maskowane w błędach magazynu', async () => {
    const constructed: unknown[] = [];
    const store = await createR2Store(fullConfig, async () => ({
      ...commands,
      S3Client: class {
        constructor(config: unknown) {
          constructed.push(config);
        }
        async send() {
          throw new Error('403 super-secret-value AKIA-ACCESS-1');
        }
      },
    }));
    const error = await store.head('k/a').catch((e: Error) => e);
    expect((error as Error).message).toBe('R2 HEAD k/a: 403 *** ***');
  });
});
