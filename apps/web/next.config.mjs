import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Minimalny, samodzielny output (.next/standalone) do obrazu Dockera -
  // znacząco mniejszy niż kopiowanie pełnego node_modules, ważne przy 1GB
  // RAM na VPS (mniej do wczytania/trzymania w pamięci procesu). Wymaga
  // outputFileTracingRoot w monorepo z npm workspaces - bez tego Next śledzi
  // zależności tylko od apps/web w dół i gubi pakiety hoistowane do root
  // node_modules (np. @cyberszkolo/shared).
  output: 'standalone',
  // Tokeny weryfikacji/resetu są w query (?token=) - bez Referrer-Policy mogłyby
  // wyciec w nagłówku Referer do zewnętrznych zasobów (np. avatar z obcego URL).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      // Dokument bloku EMBEDDED_HTML jest osadzany przez NASZĄ stronę (iframe): jedyny wyjątek od DENY, tylko SAMEORIGIN (frame-ancestors
      // 'self' ustawia sama trasa). Reguła po globalnej, więc jej wartość wygrywa.
      {
        source: '/api/courses/:courseId/blocks/:blockId/embed',
        headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }],
      },
      // Strona lądowania symulacji: token w adresie i licznik kliknięć - nigdy w cache przeglądarki/pośredników.
      {
        source: '/t/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
  experimental: {
    // W Next 14.2.x (wersja tego projektu) to nadal pole eksperymentalne -
    // dopiero w Next 15 przeniesione na najwyższy poziom configu. Sprawdź
    // przy podbijaniu wersji Next, czy nie trzeba tego przenieść.
    outputFileTracingRoot: path.join(__dirname, '../../'),
  },
};

export default nextConfig;
