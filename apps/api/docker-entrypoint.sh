#!/bin/sh
set -e

# Migracje jako krok startowy kontenera, NIE zaszyte w obrazie na etapie
# builda - uruchamiają się przy każdym starcie/restarcie, więc `docker
# compose up` po `git pull` z nowymi migracjami działa bez ręcznego kroku.
#
# `prisma migrate deploy` bierze advisory lock w Postgresie na czas
# aplikowania migracji - bezpieczne nawet gdyby w przyszłości wystartowało
# równolegle więcej niż jeden kontener `api` (drugi czeka na lock, potem widzi
# migracje już zaaplikowane i kończy natychmiast, bez błędu).
#
# Wymaga DATABASE_URL (rola migracyjna, DDL) w środowisku kontenera - patrz
# README "Wdrożenie produkcyjne". Runtime aplikacji (node dist/main.js)
# łączy się osobną rolą przez DATABASE_URL_APP, ustawianą przez PrismaService.
echo "[docker-entrypoint] Uruchamiam migracje Prisma (migrate deploy)..."
npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma
echo "[docker-entrypoint] Migracje zakończone. Startuję aplikację..."

exec node apps/api/dist/main.js
