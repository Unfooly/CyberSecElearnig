-- users.departmentId wskazywał zwykłym FK na departments(id) - baza nie pilnowała,
-- że dział należy do TEJ SAMEJ organizacji co użytkownik (FK omija RLS, więc
-- użytkownik organizacji B mógł dostać dział organizacji A, a błąd FK wobec
-- sukcesu działał jak wyrocznia istnienia cudzych id). Ta sama luka, którą
-- domknięto na legal_acceptances złożonym kluczem (organizationId, userId).
--
-- Zwykły FK "users_departmentId_fkey" (ON DELETE SET NULL) ZOSTAJE - to on
-- zeruje users.departmentId przy usunięciu działu. Złożony FK jest dodatkowy
-- (ON DELETE NO ACTION) i sprawdza tylko zgodność organizacji; przy
-- departmentId = NULL nie jest sprawdzany (MATCH SIMPLE). Prisma nie potrafi
-- wyrazić złożonego FK z opcjonalną kolumną, więc constraint żyje tylko tutaj
-- (patrz komentarz przy User.department w schema.prisma).

-- Naprawa ewentualnych istniejących powiązań międzyorganizacyjnych (nieprawidłowych
-- z definicji) - inaczej ADD CONSTRAINT poniżej przerwałaby migrację.
-- Zakładamy, że migracje biegną rolą właścicielską-superuserem (jak w każdym
-- wdrożeniu tego repo: POSTGRES_USER=cyberszkolo), która omija RLS - tak samo jak
-- wcześniejsze backfille (np. users.emailVerifiedAt). Na roli bez BYPASSRLS
-- UPDATE dotknąłby 0 wierszy, a ADD CONSTRAINT zgłosiłby głośny błąd FK.
DO $$
DECLARE
  cleared integer;
BEGIN
  UPDATE "users" u
  SET "departmentId" = NULL
  WHERE u."departmentId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "departments" d
      WHERE d."id" = u."departmentId" AND d."organizationId" = u."organizationId"
    );
  GET DIAGNOSTICS cleared = ROW_COUNT;
  RAISE NOTICE 'users.departmentId: wyzerowano % powiazan miedzy organizacjami', cleared;
END $$;

-- Cel złożonego FK musi mieć unikalny indeks na (organizationId, id).
-- Uwaga (skala): CREATE INDEX i ADD CONSTRAINT blokują zapisy do departments/users
-- na czas budowy/skanu - przy skali MVP to milisekundy. Gdy users mocno urośnie:
-- ADD CONSTRAINT ... NOT VALID + osobny VALIDATE CONSTRAINT.
CREATE UNIQUE INDEX "departments_organizationId_id_key" ON "departments"("organizationId", "id");

-- NO ACTION (nie CASCADE) także na UPDATE: kaskada złożonego FK przepisałaby w
-- users KOLUMNĘ organizationId, gdyby ktoś zmienił departments.organizationId -
-- czyli po cichu przeniosłaby użytkowników do innej organizacji.
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_departmentId_fkey"
  FOREIGN KEY ("organizationId", "departmentId") REFERENCES "departments"("organizationId", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
