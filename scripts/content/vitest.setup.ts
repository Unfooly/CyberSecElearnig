import net from 'node:net';
import { beforeEach, vi } from 'vitest';

// Testy narzędzi treści NIE mogą wołać sieci (ElevenLabs, S3/R2). Blokujemy dwie drogi: globalny fetch (undici) oraz każde gniazdo TCP
// (node:http/https, SDK, bezpośredni undici). Klienty dostają wstrzykiwany fetch albo fake'i.
const FORBIDDEN = 'Sieć w testach jest zabroniona (D-060): podaj fetchImpl albo fake.';

beforeEach(() => {
  // Odrzucona obietnica, nie wyjątek synchroniczny: kod wołający fetch widzi zwykły błąd sieci.
  globalThis.fetch = (async () => {
    throw new Error(FORBIDDEN);
  }) as typeof fetch;
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => {
    throw new Error(FORBIDDEN);
  });
});
