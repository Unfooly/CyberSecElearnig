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
RUN npm ci

COPY apps/web apps/web

# packages/shared jest już zbudowane przez postinstall powyżej (npm ci).
RUN npm run build --workspace=apps/web

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

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
