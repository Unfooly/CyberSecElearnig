# syntax=docker/dockerfile:1
#
# Multi-stage build dla apps/web (Next.js, output: 'standalone' - patrz
# next.config.mjs). Kontekst builda to ROOT repo (docker-compose.prod.yml:
# `context: .`), bo apps/web zależy od packages/shared przez lokalny
# workspace symlink, nie przez rejestr npm.

# ---- builder ------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# Manifesty osobno od źródeł - lepszy cache warstw Dockera. CELOWO bez
# apps/api/package.json - bez katalogu apps/api w kontekście `npm ci` nie
# widzi tego workspace'a i nie instaluje jego zależności (m.in. `bcrypt`,
# natywny moduł wymagający build-toolchain, którego ten obraz nie ma).
#
# packages/shared kopiujemy w CAŁOŚCI (nie tylko package.json) PRZED `npm ci`
# - root package.json ma `postinstall: npm run build --workspace=packages/shared`,
# więc `npm ci` od razu próbuje uruchomić `tsc` w packages/shared; bez
# tsconfig.json/src skopiowanych wcześniej ten krok wywala cały `npm ci`.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared packages/shared
# Root postinstall buduje też packages/content (zob. package.json), więc musi być w kontekście przed `npm ci`.
COPY packages/content packages/content
RUN npm ci

COPY apps/web apps/web

# packages/shared jest już zbudowane przez postinstall powyżej (npm ci).
RUN npm run build --workspace=apps/web

# Czytelny błąd zamiast "not found" przy COPY w etapie production, gdyby
# next.config.mjs nie miał output: 'standalone' albo zmieniło się
# experimental.outputFileTracingRoot (przy root = root repo server.js leży w
# .next/standalone/apps/web/, nie w korzeniu standalone).
# Przy porażce wypisuje diagnostykę: jaki config faktycznie jest w obrazie i
# gdzie Next umieścił server.js (jeśli w ogóle).
RUN test -f apps/web/.next/standalone/apps/web/server.js || { \
      echo "BLAD: brak apps/web/.next/standalone/apps/web/server.js" >&2; \
      echo "--- pliki next.config w obrazie:" >&2; ls -la apps/web/next.config.* >&2; \
      echo "--- linie standalone/outputFileTracingRoot:" >&2; grep -n "standalone\|outputFileTracingRoot" apps/web/next.config.* >&2 || echo "(brak takich linii)" >&2; \
      echo "--- zawartosc apps/web/.next:" >&2; ls apps/web/.next >&2; \
      echo "--- server.js pod .next:" >&2; find apps/web/.next -name server.js -not -path "*/node_modules/*" >&2; \
      exit 1; }

# ---- production -----------------------------------------------------------
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
USER nextjs

# `output: 'standalone'` z outputFileTracingRoot ustawionym na root monorepo
# odtwarza w .next/standalone dokładnie tę samą strukturę katalogów
# (apps/web/server.js, node_modules hoistowane do root) - kopiujemy to 1:1,
# bez ręcznego składania node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# DRUGA warstwa obrony (pierwsza: next.config.mjs `pageExtensions`, D-077). Strona
# apps/web/src/app/dev/player-harness/page.dev.tsx czyta packages/content/modules/*/module.json z dysku
# (fs.readFileSync, sekrety wszystkich bloków WŁĄCZNIE: klucze odpowiedzi, reactions.result, podpowiedzi). Bez
# NEXT_PUBLIC_DEV_HARNESS=1 na buildzie (tak jak w tym Dockerfile - zmienna nigdy nieustawiona) rozszerzenie
# `.dev.tsx` nie jest w pageExtensions, więc Next w ogóle nie kompiluje tego pliku jako strony - nie ma trasy, nie ma
# fs.readFileSync w grafie, @vercel/nft (output:'standalone') nie ma czego skopiować do .next/standalone. To `rm -rf`
# zostaje jako druga warstwa na wypadek błędu w tamtym mechanizmie albo przyszłej strony dev-only, która zapomni o
# rozszerzeniu `.dev.` - NIE jest to już jedyna linia obrony. To NIE jest wyciek do przeglądarki (Zasada silnika nr 1
# dotyczy tego, co dostaje KLIENT przez toClientBlock - to zostaje nienaruszone niezależnie od tego kroku, patrz
# scripts/check-no-secrets-in-bundle.mjs), ale zbędne zwiększenie powierzchni ataku kontenera web - surowe sekrety
# treści kursów na dysku serwera WWW, który wcześniej ich w ogóle nie miał (tylko apps/api je czyta, do importu).
# Bezpieczne: żaden inny kod w apps/web nie czyta packages/content/modules w runtime (prawdziwa treść kursu idzie
# z bazy przez API, nie z tych plików) - jedynym konsumentem jest strona harnessu.
RUN rm -rf packages/content/modules

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
