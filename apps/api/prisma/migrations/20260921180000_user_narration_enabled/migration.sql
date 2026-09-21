-- Ustawienie konta "lektor włączony" (narracja audio w odtwarzaczu szkoleń, PR 2 silnika scen). NOT NULL z domyślną wartością true:
-- istniejące konta dostają włączony lektor bez backfillu (users ma FORCE RLS, więc UPDATE w migracji i tak nie ruszyłby wierszy).
-- Wygenerowane przez `prisma migrate diff`; kolumna leży w tabeli z RLS (users) i nie zmienia polityk.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "narrationEnabled" BOOLEAN NOT NULL DEFAULT true;
