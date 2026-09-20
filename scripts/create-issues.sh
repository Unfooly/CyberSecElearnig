#!/usr/bin/env bash
# Zakłada w GitHub etykiety i zgłoszenia (issues) na podstawie docs/backlog-issues.md, przez gh CLI.
#
#   scripts/create-issues.sh [--dry-run] [--repo WLASCICIEL/REPO] [--file SCIEZKA] [--no-sleep]
#
# Wymagania: gh (https://cli.github.com), zalogowany (`gh auth login` albo GH_TOKEN z uprawnieniem do zgłoszeń i etykiet), awk, sed, grep.
#
# - Najpierw etykiety (`gh label create ... --force`: tworzy albo aktualizuje kolor i opis - idempotentne), potem zgłoszenia.
# - IDEMPOTENTNY: zgłoszenie jest pomijane, jeśli w repozytorium (w dowolnym stanie, otwarte lub zamknięte) istnieje już zgłoszenie
#   o tym samym numerze backlogu (B-NNN na początku tytułu), więc skrypt można uruchamiać wielokrotnie i po dopisaniu nowych wpisów.
# - Wpisy ze statusem "zrobione" są pomijane (nie zakładamy zgłoszeń na to, co już jest w kodzie).
# - Przed jakimkolwiek zapisem sprawdza, czy każda etykieta ze wpisu jest na liście skryptu (literówka = błąd, nic nie tworzymy).
# - --dry-run: tylko drukuje polecenia gh (nie woła gh, nie wymaga logowania ani sieci).
#
# Format wpisu (docs/backlog-issues.md): nagłówek `### B-NNN Tytuł`, linia `- Etykiety: `a`, `b` · Źródło: ...`, dalej Opis/Akceptacja.
set -euo pipefail

DRY_RUN=0
REPO=""
NO_SLEEP=0
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="$ROOT/docs/backlog-issues.md"

usage() {
  sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --no-sleep) NO_SLEEP=1 ;;
    --repo) REPO="${2:?--repo wymaga wartości WLASCICIEL/REPO}"; shift ;;
    --file) FILE="${2:?--file wymaga ścieżki}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Nieznany argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[ -f "$FILE" ] || { echo "Brak pliku: $FILE" >&2; exit 1; }

# Etykiety: nazwa|kolor (hex bez #)|opis. Priorytet, typ, moduł; "good first issue" istnieje domyślnie w GitHub (--force tylko wyrównuje opis).
LABELS=(
  "P1|b60205|Przed publicznym startem"
  "P2|d93f0b|Wkrótce"
  "P3|fbca04|Kiedyś"
  "bug|d73a4a|Błąd"
  "security|ee0701|Bezpieczeństwo"
  "tech-debt|5319e7|Dług techniczny"
  "feature|0e8a16|Nowa funkcja"
  "docs|0075ca|Dokumentacja"
  "ops|1d76db|Operacje, wdrożenie, monitoring"
  "decision-needed|c5def5|Wymaga decyzji właściciela produktu przed implementacją"
  "mod:auth|bfdadc|Moduł: auth"
  "mod:rejestracja|bfdadc|Moduł: rejestracja firm"
  "mod:kursy|bfdadc|Moduł: e-learning"
  "mod:dashboard|bfdadc|Moduł: dashboard i raporty"
  "mod:phishing|bfdadc|Moduł: symulacje phishingowe"
  "mod:zgloszenia|bfdadc|Moduł: zgłaszanie zagrożeń"
  "mod:import|bfdadc|Moduł: import pracowników i zaproszenia"
  "mod:gamifikacja|bfdadc|Moduł: gamifikacja"
  "mod:web|bfdadc|Frontend (apps/web)"
  "mod:ci|bfdadc|CI/CD i narzędzia"
  "mod:db|bfdadc|Baza danych i migracje"
  "good first issue|7057ff|Dobre na pierwsze zadanie"
)

label_known() {
  local wanted="$1" entry
  for entry in "${LABELS[@]}"; do
    [ "${entry%%|*}" = "$wanted" ] && return 0
  done
  return 1
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Rozbiór pliku: dla każdego wpisu `### B-NNN ...` powstają NNN.title / NNN.body (wpis kończy się kolejnym nagłówkiem ###, ## albo ---).
tr -d '\r' < "$FILE" | awk -v dir="$WORK" '
  /^### B-[0-9]+ / {
    if (out != "") close(out)
    n++
    base = sprintf("%s/%04d", dir, n)
    title = substr($0, 5)
    print title > (base ".title")
    out = base ".body"
    printf "" > out
    next
  }
  /^## / || /^---[[:space:]]*$/ { if (out != "") close(out); out = ""; next }
  out != "" { print $0 >> out }
'

shopt -s nullglob
TITLE_FILES=("$WORK"/*.title)
[ "${#TITLE_FILES[@]}" -gt 0 ] || { echo "Nie znaleziono wpisów (### B-NNN ...) w $FILE" >&2; exit 1; }

label_list_of() { # etykiety wpisu z linii "- Etykiety: `a`, `b` · Źródło: ..." (tylko przed "·")
  grep -m1 '^- Etykiety:' "$1" | sed 's/^- Etykiety:[[:space:]]*//; s/[[:space:]]*·.*$//' | grep -o '`[^`]*`' | tr -d '`' || true
}

# 1) Walidacja przed jakimkolwiek zapisem.
errors=0
for tf in "${TITLE_FILES[@]}"; do
  base="${tf%.title}"
  title="$(cat "$tf")"
  if ! grep -q '^- Etykiety:' "$base.body"; then
    echo "BŁĄD: wpis \"$title\" nie ma linii '- Etykiety:'" >&2
    errors=$((errors + 1))
    continue
  fi
  while IFS= read -r lbl; do
    [ -n "$lbl" ] || continue
    if ! label_known "$lbl"; then
      echo "BŁĄD: wpis \"$title\" używa nieznanej etykiety: $lbl (dopisz ją do LABELS w skrypcie)" >&2
      errors=$((errors + 1))
    fi
  done < <(label_list_of "$base.body")
done
[ "$errors" -eq 0 ] || { echo "Przerywam: $errors błędów w $FILE, nic nie utworzono." >&2; exit 1; }

REPO_ARGS=()
[ -n "$REPO" ] && REPO_ARGS=(--repo "$REPO")

run() { # drukuje polecenie (dry-run) albo je wykonuje
  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'gh'
    printf ' %q' "$@"
    printf '\n'
  else
    gh "$@"
  fi
}

if [ "$DRY_RUN" -eq 0 ]; then
  command -v gh >/dev/null 2>&1 || { echo "Brak gh (https://cli.github.com)." >&2; exit 1; }
  gh auth status >/dev/null 2>&1 || { echo "gh nie jest zalogowane (gh auth login albo GH_TOKEN)." >&2; exit 1; }
  EXISTING="$(gh issue list --state all --limit 5000 --json title --jq '.[].title' "${REPO_ARGS[@]}")"
else
  EXISTING=""
  echo "# --dry-run: polecenia poniżej NIE są wykonywane; istnienie zgłoszeń nie jest sprawdzane (przy prawdziwym uruchomieniu istniejące zostaną pominięte)." >&2
fi

# 2) Etykiety (idempotentnie).
for entry in "${LABELS[@]}"; do
  IFS='|' read -r name color desc <<<"$entry"
  run label create "$name" --color "$color" --description "$desc" --force "${REPO_ARGS[@]}"
done

# 3) Zgłoszenia (pomijamy istniejące po numerze B-NNN oraz wpisy "zrobione").
created=0
skipped=0
for tf in "${TITLE_FILES[@]}"; do
  base="${tf%.title}"
  title="$(cat "$tf")"
  id="${title%% *}"

  if grep -q '^- \*\*Status: zrobione' "$base.body"; then
    echo "pomijam (zrobione): $id" >&2
    skipped=$((skipped + 1))
    continue
  fi
  if [ -n "$EXISTING" ] && printf '%s\n' "$EXISTING" | grep -Eq "^${id}([[:space:]]|\$)"; then
    echo "pomijam (już istnieje): $id" >&2
    skipped=$((skipped + 1))
    continue
  fi

  body_file="$base.issue.md"
  {
    cat "$base.body"
    printf '\n---\nWpis z `docs/backlog-issues.md` (%s). Po zamknięciu zgłoszenia oznacz wpis tam jako zrobiony.\n' "$id"
  } > "$body_file"

  args=(issue create --title "$title" --body-file "$body_file")
  while IFS= read -r lbl; do
    [ -n "$lbl" ] && args+=(--label "$lbl")
  done < <(label_list_of "$base.body")
  args+=("${REPO_ARGS[@]}")

  run "${args[@]}"
  created=$((created + 1))
  if [ "$DRY_RUN" -eq 0 ] && [ "$NO_SLEEP" -eq 0 ]; then
    sleep 1 # ograniczenie tempa tworzenia (limity wtórne GitHub)
  fi
done

echo "Gotowe: zgłoszeń do utworzenia/utworzonych: $created, pominiętych: $skipped." >&2
