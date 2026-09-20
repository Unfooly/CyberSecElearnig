-- Retencja zgłoszeń (decyzja właściciela produktu 2026-09-20): po 90 dniach czyścimy też nadawcę i temat zgłoszeń prawdziwych;
-- zostaje wyłącznie domena nadawcy (statystyki "najczęstsze domeny"). Stąd senderText i subject stają się nullable.
--
-- (Wygenerowane przez `prisma migrate diff` linie DROP CONSTRAINT dla SQL-only złożonych FK zostały USUNIĘTE ręcznie -
-- Prisma ich nie potrafi wyrazić; patrz README, "Backlog bazy danych".)

-- AlterTable
ALTER TABLE "threat_reports" ADD COLUMN     "senderDomain" VARCHAR(255),
ALTER COLUMN "senderText" DROP NOT NULL,
ALTER COLUMN "subject" DROP NOT NULL;

-- Uzupełnienie domeny dla istniejących zgłoszeń (adres w "Nazwa <adres>" albo sam adres); brak adresu = NULL.
UPDATE "threat_reports"
SET "senderDomain" = lower(substring("senderText" from '@([A-Za-z0-9.-]+\.[A-Za-z]{2,})'))
WHERE "senderDomain" IS NULL AND "senderText" IS NOT NULL;
