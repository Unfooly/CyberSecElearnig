-- Wysyłka zaproszeń z importu: rozróżnienie PEWNEGO niepowodzenia (FAILED) i NIEPEWNEGO wyniku (UNCERTAIN: timeout, HTTP 5xx,
-- zerwane połączenie, awaria procesu po zajęciu) - jak RESULT_UNKNOWN w wysyłce kampanii phishingowych.
--
-- Uwaga: nowa wartość enuma NIE jest użyta w tej migracji (PostgreSQL nie pozwala jej używać w tej samej transakcji, w której
-- została dodana) - żadne CHECK ani DEFAULT się do niej nie odwołuje.

-- AlterEnum
ALTER TYPE "UserImportInviteStatus" ADD VALUE 'UNCERTAIN';
