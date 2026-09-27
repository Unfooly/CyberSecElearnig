-- D-084: miniatura modułu 16:9 do katalogu i karty kursu (ścieżka zasobu modułu w magazynie treści), wypełniana wyłącznie
-- przez content-import. Addytywnie: NULL dla istniejących kursów = karta bez miniatury (dotychczasowy wygląd). `courses` jest
-- globalna (katalog treści, bez organizationId i RLS), więc bez polityk.
-- Wygenerowane `prisma migrate diff`; pozostałe różnice (złożone FK, których Prisma nie wyraża) celowo pominięte, jak w
-- poprzednich migracjach.

-- AlterTable
ALTER TABLE "courses" ADD COLUMN "thumbnail" VARCHAR(300);
