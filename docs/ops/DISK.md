# Dysk VPS - runbook (chore/disk-hygiene)

VPS raz się już zapchał (logi kontenerów bez limitu, stare obrazy po kolejnych wdrożeniach, dziennik systemowy). Ten dokument mówi,
jak to wykryć, jak posprzątać i co ustawić na hoście, żeby nie wróciło.

## Próg

**80% zajętości `/`** - powyżej sprzątamy od razu (sekcja „Sprzątanie”). Powyżej 90% Postgres może przestać przyjmować zapisy
(WAL), a Redis (AOF) - odrzucać zapisy sesji; wtedy najpierw sprzątanie, dopiero potem diagnoza.

## Co jest w repo

| element | co robi |
|---|---|
| `docker-compose.prod.yml` - `x-logging` | każda usługa: logi `json-file`, max 10 MB × 3 pliki (≤ 30 MB na kontener) |
| `scripts/ops/disk-report.sh` | **tylko odczyt**: `df -h /`, `docker system df`, 5 największych logów kontenerów, `journalctl --disk-usage` |
| `scripts/ops/disk-cleanup.sh` | obrazy nieużywane i cache buildera starsze niż 7 dni, dziennik systemowy do 200 MB |
| `scripts/ops/disk-hygiene.test.mjs` | test w CI: żaden skrypt w `scripts/ops` nie czyści wolumenów; compose ma rotację logów |

**ZAKAZ:** `--volumes`, `docker volume prune`, `docker volume rm`, `docker system prune`, `docker compose down -v`. Wolumen
`postgres_data` to baza produkcyjna **bez kopii zapasowej** - jej usunięcie jest nieodwracalne. Test w CI odrzuci skrypt, który to robi.

## Diagnoza

```bash
cd ~/unfooly            # katalog repo na VPS
bash scripts/ops/disk-report.sh
```

Czytanie wyniku: duże `Images` z `RECLAIMABLE` → stare obrazy (sprzątanie); duży log kontenera → kontener przed wdrożeniem rotacji
(po `up -d` z nową konfiguracją log zaczyna się od nowa, stary znika razem z kontenerem); duży `journald` → limit na hoście (niżej).

## Sprzątanie

```bash
bash scripts/ops/disk-cleanup.sh
```

Bezpieczne przy działającym stacku: usuwa tylko obrazy, których nie używa żaden kontener (bieżące `api`/`web` zostają), i cache buildera.
Wycofanie na starszy tag (`IMAGE_TAG=sha-…`) po sprzątaniu wymaga ponownego `docker compose pull` (obraz jest w GHCR).

## Jednorazowo na hoście (ręcznie - nie robi tego żaden skrypt)

1. **Rotacja logów w działających kontenerach** - nowa konfiguracja `logging` działa dopiero po odtworzeniu kontenerów (zmiana
   konfiguracji wystarczy, żeby zwykłe `up -d` je odtworzyło). **Uwaga:** to krótka przerwa (restart postgres i redis, żądania w locie
   dostaną błąd), ponowne uruchomienie `migrate` i `content-import` oraz **utrata starych logów** kontenerów - rób to poza godzinami
   pracy, a potrzebne logi zapisz wcześniej (`docker compose ... logs <usługa> > plik`).

   ```bash
   git pull
   docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
   ```

2. **Limit dziennika systemowego (journald):** w `/etc/systemd/journald.conf` ustaw `SystemMaxUse=200M`, potem
   `sudo systemctl restart systemd-journald`.
3. **Cotygodniowe sprzątanie (cron):** wyłącznie crontab roota (`sudo crontab -e` - w crontabie zwykłego użytkownika `sudo journalctl`
   w skrypcie wymagałby hasła) i wpis (niedziela 3:30, wynik do dziennika):

   ```
   30 3 * * 0 cd /home/<użytkownik>/unfooly && bash scripts/ops/disk-cleanup.sh 2>&1 | logger -t disk-cleanup
   ```

   Jeśli stack jest akurat zatrzymany (`down`), sprzątanie usunie też bieżące obrazy api/web - powrót wymaga `docker compose pull`
   (token GHCR ważny 90 dni - docs/deploy-test.md).

   Opcjonalnie domyślna rotacja dla kontenerów spoza compose (np. ręczne `docker run`): `/etc/docker/daemon.json` z
   `{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}` i `sudo systemctl restart docker` (restart wszystkich kontenerów).

4. **Kontrola:** `bash scripts/ops/disk-report.sh` - zajętość poniżej progu, logi kontenerów ≤ 30 MB każdy.

## Backup bazy

Brak kopii zapasowej `postgres_data` to osobne ryzyko (backlog) - dopóki go nie ma, żadna operacja na wolumenach.
