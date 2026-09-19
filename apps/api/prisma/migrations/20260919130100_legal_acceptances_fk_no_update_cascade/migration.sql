-- Złożony FK legal_acceptances (organizationId, userId) -> users(organizationId, id)
-- miał ON UPDATE CASCADE. Kaskada złożonego FK przepisuje KOLUMNĘ organizationId,
-- więc zmiana users.organizationId po cichu przeniosłaby zgody do innej
-- organizacji. Zmiana organizacji użytkownika nie jest wspieraną operacją, więc
-- właściwe jest odrzucenie (NO ACTION), tak jak w users -> departments.
ALTER TABLE "legal_acceptances" DROP CONSTRAINT "legal_acceptances_organizationId_userId_fkey";
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_organizationId_userId_fkey"
  FOREIGN KEY ("organizationId", "userId") REFERENCES "users"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
