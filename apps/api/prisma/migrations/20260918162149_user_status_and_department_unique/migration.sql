-- Moduł zarządzania/zapraszania pracowników (apps/api/src/users):
-- 1) User.status rozróżnia ACTIVE (hasło ustawione) od INVITED (czeka na
--    pierwsze hasło przez ten sam PasswordResetToken flow co "zapomniałem
--    hasła" - patrz AuthService.issuePasswordResetUrl/resetPassword).
-- 2) Department dostaje unikalność (organizationId, name) - wymagane do
--    bezpiecznego find-or-create działu przy imporcie CSV (UsersService.importCsv).

CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED');

ALTER TABLE "users" ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE UNIQUE INDEX "departments_organizationId_name_key" ON "departments"("organizationId", "name");
