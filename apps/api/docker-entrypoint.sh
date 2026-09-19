#!/bin/sh
set -e

# Migracje NIE działają już tutaj - to osobny, jednorazowy krok compose
# (usługa `migrate` w docker-compose.prod.yml, `service_completed_successfully`
# przed startem api). Dzięki temu restart samego api nie dotyka schematu bazy,
# a błąd migracji zatrzymuje wdrożenie zamiast zapętlać restartujący się kontener.
#
# Runtime aplikacji łączy się rolą z DATABASE_URL_APP (ograniczona przez RLS).
exec node apps/api/dist/main.js
