-- Tryb prosty (D-132): wersja kursu z module.json `simpleMode` - ocena każdego kliknięcia od razu (/check) i odtwarzacz dla osób
-- nietechnicznych. Addytywnie: istniejące wersje (moduły 1 i 2) dostają false.
-- AlterTable
ALTER TABLE "course_versions" ADD COLUMN     "simpleMode" BOOLEAN NOT NULL DEFAULT false;
