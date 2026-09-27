#!/usr/bin/env bash
# Raport zajętości dysku VPS (chore/disk-hygiene, docs/ops/DISK.md). WYŁĄCZNIE ODCZYT - niczego nie usuwa ani nie zmienia.
# Użycie na VPS (z katalogu repo): bash scripts/ops/disk-report.sh
# Bez `set -e`: to narzędzie diagnostyczne - awaria jednej sekcji (np. Docker nie działa przy pełnym dysku) nie może ukryć pozostałych.
set -uo pipefail

section() { printf '\n=== %s ===\n' "$1"; }

section "Dysk / (próg alarmowy: 80%)"
df -h /

section "Docker: obrazy, kontenery, wolumeny, cache buildera"
docker system df || echo "(docker system df niedostępne - czy demon działa i użytkownik jest w grupie docker?)"

section "Top 5 logów kontenerów (json-file)"
# Ścieżki logów bez uruchamiania czegokolwiek w kontenerach; sudo tylko do odczytu /var/lib/docker.
docker ps -aq | while read -r id; do
  path=$(docker inspect --format '{{.LogPath}}' "$id" 2>/dev/null || true)
  name=$(docker inspect --format '{{.Name}}' "$id" 2>/dev/null | sed 's#^/##' || true)
  if [ -n "$path" ] && sudo test -f "$path"; then
    size=$(sudo du -b "$path" | cut -f1)
    printf '%s\t%s\n' "$size" "$name"
  fi
done | sort -rn | head -n 5 | awk -F'\t' '{ printf "%8.1f MB  %s\n", $1 / 1048576, $2 }'

section "Dziennik systemowy (journald)"
# sudo: bez niego journalctl liczy tylko dzienniki bieżącego użytkownika (mylący wynik).
sudo journalctl --disk-usage || echo "(journalctl niedostępny)"
