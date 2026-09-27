#!/usr/bin/env bash
# Sprzątanie dysku VPS (chore/disk-hygiene, docs/ops/DISK.md): stare obrazy i cache buildera Dockera (> 7 dni) oraz dziennik
# systemowy powyżej 200 MB. Użycie na VPS (z katalogu repo): bash scripts/ops/disk-cleanup.sh
#
# ZAKAZ: żadnego czyszczenia wolumenów (flaga "--volumes", "docker volume prune", "docker system prune"). W wolumenie
# postgres_data jest baza produkcyjna BEZ kopii zapasowej - jej utrata jest nieodwracalna. Pilnuje tego test w CI:
# scripts/ops/disk-hygiene.test.mjs.
set -euo pipefail

echo "Przed:"
df -h /

# Obrazy nieużywane przez żaden kontener, starsze niż 7 dni (bieżące api/web są używane - zostają; stare tagi sha-* do wycofania znikają).
docker image prune -af --filter "until=168h"

# Cache buildera starszy niż 7 dni (na VPS nie budujemy obrazów, ale `docker build` do testów zostawia cache).
docker builder prune -af --filter "until=168h"

# Dziennik systemowy: przycięcie do 200 MB (trwały limit: SystemMaxUse=200M w journald.conf - docs/ops/DISK.md).
sudo journalctl --vacuum-size=200M

echo "Po:"
df -h /
