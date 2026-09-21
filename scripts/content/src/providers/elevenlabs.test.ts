import { describe, expect, it, vi } from 'vitest';
import { ElevenLabsProvider, MAX_TEXT_CHARS } from './elevenlabs.js';

const API_KEY = 'xi-super-secret-key-123';
const request = { text: 'Spójrz na adres nadawcy. Drugie zdanie.', voiceId: 'voice_ABC123xyz', model: 'eleven_multilingual_v2', language: 'pl' };

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x01, 0x02]); // nagłówek ID3
const okBody = (overrides: Record<string, unknown> = {}) => ({
  audio_base64: Buffer.from(MP3).toString('base64'),
  alignment: {
    characters: ['S', 'p'],
    character_start_times_seconds: [0, 0.1],
    character_end_times_seconds: [0.1, 0.2],
  },
  normalized_alignment: null,
  ...overrides,
});

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function provider(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof ElevenLabsProvider>[0]> = {}) {
  const sleep = vi.fn(async (_ms: number) => {});
  return { sleep, provider: new ElevenLabsProvider({ apiKey: API_KEY, fetchImpl, sleep, ...extra }) };
}

describe('ElevenLabsProvider: żądanie', () => {
  it('POST na with-timestamps: URL z zakodowanym voiceId, klucz tylko w nagłówku xi-api-key, model i tekst w ciele', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody()));
    const { provider: tts } = provider(fetchImpl as unknown as typeof fetch);
    await tts.synthesize(request);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice_ABC123xyz/with-timestamps?output_format=mp3_44100_128');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe(API_KEY);
    expect(url).not.toContain(API_KEY);
    expect(JSON.parse(init.body as string)).toEqual({ text: request.text, model_id: 'eleven_multilingual_v2' });
  });

  it('language_code tylko dla modeli, które go obsługują (multilingual v2 wykrywa język z tekstu)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody()));
    const { provider: tts } = provider(fetchImpl as unknown as typeof fetch);
    await tts.synthesize({ ...request, model: 'eleven_flash_v2_5' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ model_id: 'eleven_flash_v2_5', language_code: 'pl' });
  });

  it('wynik: nagranie z base64 i alignment w formie camelCase', async () => {
    const { provider: tts } = provider((async () => jsonResponse(200, okBody())) as unknown as typeof fetch);
    const result = await tts.synthesize(request);
    expect(Array.from(result.audio)).toEqual(Array.from(MP3));
    expect(result.alignment).toEqual({ characters: ['S', 'p'], characterStartTimesSeconds: [0, 0.1], characterEndTimesSeconds: [0.1, 0.2] });
  });

  it.each(['../x', 'a/b', 'a b', '', 'x'.repeat(65), 'a?b'])('voiceId %j jest odrzucany przed wysłaniem (bez wstrzykiwania ścieżki)', async (voiceId) => {
    const fetchImpl = vi.fn();
    const { provider: tts } = provider(fetchImpl as unknown as typeof fetch);
    await expect(tts.synthesize({ ...request, voiceId })).rejects.toThrow(/VOICE_ID/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pusty i zbyt długi tekst są odrzucane lokalnie (bez zużycia budżetu)', async () => {
    const fetchImpl = vi.fn();
    const { provider: tts } = provider(fetchImpl as unknown as typeof fetch);
    await expect(tts.synthesize({ ...request, text: '   ' })).rejects.toThrow(/Pusty/);
    await expect(tts.synthesize({ ...request, text: 'a'.repeat(MAX_TEXT_CHARS + 1) })).rejects.toThrow(/limit żądania/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('brak klucza API to błąd konstruktora', () => {
    expect(() => new ElevenLabsProvider({ apiKey: '' })).toThrow(/ELEVENLABS_API_KEY/);
  });
});

describe('ElevenLabsProvider: ponowienia i błędy', () => {
  it('429 z Retry-After: czeka podany czas i ponawia; potem sukces', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { detail: { message: 'Too many requests' } }, { 'Retry-After': '7' }))
      .mockResolvedValueOnce(jsonResponse(200, okBody()));
    const { provider: tts, sleep } = provider(fetchImpl as unknown as typeof fetch);
    await tts.synthesize(request);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('5xx i błąd sieci: wykładniczy backoff 1 s, 2 s; po wyczerpaniu prób błąd z liczbą prób i ostatnim błędem', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse(200, okBody()));
    const { provider: tts, sleep } = provider(fetchImpl as unknown as typeof fetch);
    await tts.synthesize(request);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);

    const failing = vi.fn(async () => jsonResponse(500, {}));
    const { provider: tts2 } = provider(failing as unknown as typeof fetch, { maxRetries: 2 });
    await expect(tts2.synthesize(request)).rejects.toThrow(/3 prób.*HTTP 500/);
    expect(failing).toHaveBeenCalledTimes(3);
  });

  it('401/403 i inne 4xx: bez ponowień; komunikat bez klucza API', async () => {
    for (const status of [401, 403, 422]) {
      const fetchImpl = vi.fn(async () => jsonResponse(status, { detail: { message: `odrzucono klucz ${API_KEY}` } }));
      const { provider: tts, sleep } = provider(fetchImpl as unknown as typeof fetch);
      const error = await tts.synthesize(request).catch((e: Error) => e);
      expect((error as Error).message).toContain(String(status));
      expect((error as Error).message).not.toContain(API_KEY);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it('błąd sieci po wyczerpaniu prób nie ujawnia klucza nawet, gdy komunikat sieciowy go zawiera', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`fetch failed: xi-api-key=${API_KEY}`);
    });
    const { provider: tts } = provider(fetchImpl as unknown as typeof fetch, { maxRetries: 1 });
    const error = await tts.synthesize(request).catch((e: Error) => e);
    expect((error as Error).message).toContain('2 prób');
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it('własny redact DOKŁADA reguły, nie zastępuje maskowania klucza', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { detail: { message: `zły ${API_KEY} i sekret-dodatkowy` } }));
    const { provider: tts } = provider(fetchImpl as unknown as typeof fetch, { redact: (text) => text.replace('sekret-dodatkowy', '###') });
    const error = await tts.synthesize(request).catch((e: Error) => e);
    expect((error as Error).message).toContain('zły *** i ###');
  });

  it('tekst błędu od serwera: bez znaków sterujących (escape terminala) i najwyżej 200 znaków', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { detail: { message: `\u001b[31mCZERWONY\u001b[0m${'x'.repeat(500)}` } }));
    const { provider: tts } = provider(fetchImpl as unknown as typeof fetch);
    const message = ((await tts.synthesize(request).catch((e: Error) => e)) as Error).message;
    expect(message).not.toMatch(/[\u0000-\u001f]/);
    expect(message.length).toBeLessThan(320);
  });

  it('błędy walidacji odpowiedzi też nie ujawniają klucza (audio/alignment z kluczem w treści)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody({ audio_base64: Buffer.from(`tekst ${API_KEY}`).toString('base64') })));
    const { provider: tts } = provider(fetchImpl as unknown as typeof fetch);
    const error = await tts.synthesize(request).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/nie jest nagraniem mp3/);
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it('przekroczenie czasu przerywa żądanie (AbortSignal) i jest ponawiane', async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const { provider: tts } = provider(fetchImpl as unknown as typeof fetch, { maxRetries: 1, timeoutMs: 5 });
    await expect(tts.synthesize(request)).rejects.toThrow(/przekroczono czas 5 ms/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('żądanie z kluczem NIE podąża za przekierowaniami (redirect: "error"): xi-api-key nie pojedzie pod obcy host', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody()));
    const { provider: tts } = provider(fetchImpl as unknown as typeof fetch);
    await tts.synthesize(request);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.redirect).toBe('error');
  });

  it('przekroczenie czasu OBEJMUJE odczyt ciała: zawieszone ciało nie wiesza potoku; timeout ponawiany najwyżej raz', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, init: RequestInit) =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          // Nagłówki dotarły, ciało "wisi" do przerwania żądania.
          json: () => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))),
        }) as unknown as Response,
    );
    const { provider: tts, sleep } = provider(fetchImpl as unknown as typeof fetch, { timeoutMs: 5, maxRetries: 5 });
    await expect(tts.synthesize(request)).rejects.toThrow(/przekroczeniach czasu/);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // pierwsza próba + JEDNO ponowienie mimo maxRetries = 5
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['https://api.elevenlabs.io', true],
    ['https://api.elevenlabs.io/', true],
    ['http://api.elevenlabs.io', false],
    ['https://obcy-host.example', false],
    ['https://api.elevenlabs.io.evil.example', false],
    ['https://user:haslo@api.elevenlabs.io', false],
    ['nie-url', false],
  ])('adres API %s: %s (klucz nie może trafić pod inny host ani po http)', (baseUrl, ok) => {
    const build = () => new ElevenLabsProvider({ apiKey: API_KEY, baseUrl, fetchImpl: vi.fn() as unknown as typeof fetch });
    if (ok) expect(build).not.toThrow();
    else expect(build).toThrow(/api\.elevenlabs\.io|Niepoprawny adres/);
  });

  it('allowAnyBaseUrl (tylko testy) pozwala na inny adres', () => {
    expect(() => new ElevenLabsProvider({ apiKey: API_KEY, baseUrl: 'http://localhost:9999', allowAnyBaseUrl: true })).not.toThrow();
  });

  it('nagranie ponad limit (30 MB) i deklarowany zbyt duży rozmiar odpowiedzi są odrzucane bez ponowień', async () => {
    const huge = 'A'.repeat(41_943_040 + 100);
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody({ audio_base64: huge })));
    const { provider: tts } = provider(fetchImpl as unknown as typeof fetch);
    await expect(tts.synthesize(request)).rejects.toThrow(/przekracza 30 MB/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const declared = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-length': String(200_000_000) } }));
    const { provider: tts2 } = provider(declared as unknown as typeof fetch);
    await expect(tts2.synthesize(request)).rejects.toThrow(/zbyt duża/);
  });

  it('AAC (ADTS 0xFF 0xF1) nie jest przyjmowany jako mp3; ramka MPEG Layer III (0xFF 0xFB) tak', async () => {
    const aac = Buffer.from([0xff, 0xf1, 0x50, 0x80]).toString('base64');
    const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00]).toString('base64');
    const { provider: bad } = provider((async () => jsonResponse(200, okBody({ audio_base64: aac }))) as unknown as typeof fetch);
    await expect(bad.synthesize(request)).rejects.toThrow(/nie jest nagraniem mp3/);
    const { provider: good } = provider((async () => jsonResponse(200, okBody({ audio_base64: mp3 }))) as unknown as typeof fetch);
    await expect(good.synthesize(request)).resolves.toBeDefined();
  });

  it.each([
    ['różne długości tablic', { characters: ['a', 'b'], character_start_times_seconds: [0], character_end_times_seconds: [0.1, 0.2] }],
    ['NaN w czasach', { characters: ['a'], character_start_times_seconds: [Number.NaN], character_end_times_seconds: [0.1] }],
    ['ujemny czas', { characters: ['a'], character_start_times_seconds: [-1], character_end_times_seconds: [0.1] }],
    ['koniec przed początkiem', { characters: ['a'], character_start_times_seconds: [0.5], character_end_times_seconds: [0.1] }],
    ['pusty alignment', { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] }],
    ['zbyt duże tablice', { characters: new Array(20_001).fill('a'), character_start_times_seconds: new Array(20_001).fill(0), character_end_times_seconds: new Array(20_001).fill(0.1) }],
  ])('alignment: %s to błąd bez ponowień', async (_label, alignment) => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody({ alignment })));
    const { provider: tts } = provider(fetchImpl as unknown as typeof fetch);
    await expect(tts.synthesize(request)).rejects.toThrow(/alignment/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['brak audio_base64', okBody({ audio_base64: undefined }), /nie zawiera nagrania/],
    ['puste audio', okBody({ audio_base64: '' }), /nie zawiera nagrania/],
    ['audio nie jest mp3', okBody({ audio_base64: Buffer.from('to nie mp3').toString('base64') }), /nie jest nagraniem mp3/],
    ['brak alignment', okBody({ alignment: null }), /alignment/],
    ['zły alignment', okBody({ alignment: { characters: [1], character_start_times_seconds: [], character_end_times_seconds: [] } }), /alignment/],
  ])('zły kształt odpowiedzi (%s): błąd bez ponowień (budżet nie jest palony drugi raz)', async (_label, body, message) => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, body));
    const { provider: tts, sleep } = provider(fetchImpl as unknown as typeof fetch);
    await expect(tts.synthesize(request)).rejects.toThrow(message);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('domyślny fetch to globalny (w testach zablokowany): bez wstrzyknięcia próba sieci kończy się błędem, nie wywołaniem ElevenLabs', async () => {
    const tts = new ElevenLabsProvider({ apiKey: API_KEY, maxRetries: 0 });
    await expect(tts.synthesize(request)).rejects.toThrow();
  });
});
