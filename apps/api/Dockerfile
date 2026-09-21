# syntax=docker/dockerfile:1
#
# Multi-stage build dla apps/api (NestJS). Kontekst builda to ROOT repo
# (docker-compose.prod.yml: `context: .`), bo to monorepo npm workspaces -
# apps/api zależy od packages/shared przez lokalny symlink workspace, nie
# przez rejestr npm.

# ---- builder ------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# python3/make/g++ - `bcrypt` to natywny moduł (node-gyp), obrazy Alpine nie
# mają zawsze gotowego prebuildu dla tej kombinacji platformy/libc (musl), więc
# kompilujemy ze źródła. openssl - potrzebne przez silniki Prisma (generate).
RUN apk add --no-cache python3 make g++ openssl

# Najpierw same manifesty (lepszy cache warstw Dockera). CELOWO bez
# apps/web/package.json - `npm ci` bez katalogu apps/web w kontekście po
# prostu nie widzi tego workspace'a (glob `apps/*` w root package.json go nie
# znajdzie), więc nie instaluje jego zależności (Next.js/React) do wspólnego,
# hoistowanego node_modules. Backend ich nie potrzebuje w runtime.
#
# packages/shared kopiujemy w CAŁOŚCI (nie tylko package.json) PRZED `npm ci`
# - root package.json ma `postinstall: npm run build --workspace=packages/shared`,
# więc `npm ci` od razu próbuje uruchomić `tsc` w packages/shared; bez
# tsconfig.json/src skopiowanych wcześniej ten krok wywala cały `npm ci`.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared packages/shared
# packages/content (schematy bloków, walidacja modułów) - też budowane przez postinstall, więc kopiowane przed `npm ci`.
COPY packages/content packages/content
RUN npm ci

# Placeholder na czas builda - `prisma generate` czyta schema.prisma (który
# odwołuje się do env("DATABASE_URL")), ale nie łączy się z bazą. Prawdziwy
# DATABASE_URL trafia do kontenera dopiero w runtime przez env_file (.env).
ENV DATABASE_URL="postgresql://user:password@localhost:5432/db"

COPY apps/api apps/api

# packages/shared jest już zbudowane przez postinstall powyżej (npm ci).
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma \
  && npm run build --workspace=apps/api

# Usuwa devDependencies z ISTNIEJĄCEGO drzewa node_modules (nie reinstaluje) -
# `bcrypt` zostaje skompilowany raz, `@prisma/client`/wygenerowany klient
# zostają (są w dependencies), a `prisma` CLI (przeniesiony do dependencies -
# patrz apps/api/package.json - potrzebny w runtime dla docker-entrypoint.sh)
# też przetrwa.
RUN npm prune --omit=dev

# ---- production -----------------------------------------------------------
FROM node:20-alpine AS production
WORKDIR /app

# Silnik zapytań Prisma w runtime też potrzebuje libssl.
RUN apk add --no-cache openssl

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
# Zależności ZAGNIEŻDŻONE w workspace (npm nie hoistuje ich, gdy w korzeniu jest inna wersja - np. przypięty
# sanitize-html 2.13.1): bez tego kontener API kończy się na "Cannot find module 'sanitize-html'".
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/content/package.json ./packages/content/package.json
COPY --from=builder /app/packages/content/dist ./packages/content/dist
# re2 (natywny moduł, dopasowanie i walidacja regexów odpowiedzi) jest wg package-lock zainstalowany ZAGNIEŻDŻONY w workspace
# (packages/content/node_modules), więc samo kopiowanie /app/node_modules go nie obejmuje: bez tego kontener API kończy się na
# "Cannot find module 're2'". Jeśli lockfile kiedyś zhoistuje re2 do korzenia, ten COPY zawiedzie głośno (brak katalogu) - wtedy usuń go.
COPY --from=builder /app/packages/content/node_modules ./packages/content/node_modules
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
# Migrations + schema - wymagane w runtime przez usługę `migrate`
# (`prisma migrate deploy`), nie tylko na etapie builda.
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

COPY apps/api/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["./docker-entrypoint.sh"]
