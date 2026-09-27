-- D-089: moment pierwszego rozpoczęcia przypisania (NOT_STARTED -> IN_PROGRESS w /start), do czasu śledztwa na ekranie zamknięcia
-- sprawy. Addytywnie: NULL dla istniejących wierszy (czas nieznany - ekran pokazuje "—"). `course_assignments` ma już RLS i polityki
-- per organizacja (kolumna ich nie zmienia).

-- AlterTable
ALTER TABLE "course_assignments" ADD COLUMN "startedAt" TIMESTAMP(3);
