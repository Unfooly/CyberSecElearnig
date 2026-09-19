-- Samoobsługowa rejestracja firmy (etap 2): nazwa organizacji przestaje być
-- domeną e-maila, więc znika jej unikalność (kilka organizacji może mieć tę samą
-- nazwę wyświetlaną; o "własności" domeny rozstrzyga weryfikacja DNS, nie nazwa).
-- Jednocześnie domyślny status NOWYCH organizacji zmienia się na
-- PENDING_DOMAIN_VERIFICATION (fail-closed) - nowy kod rejestracji tworzy razem z
-- organizacją wiersz organization_domains, więc okno z poprzedniego etapu
-- (stary kod + status PENDING) już nie istnieje. Istniejące organizacje zostają ACTIVE.
DROP INDEX "organizations_name_key";

ALTER TABLE "organizations" ALTER COLUMN "status" SET DEFAULT 'PENDING_DOMAIN_VERIFICATION';
