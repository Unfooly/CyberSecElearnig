-- Nazwa organizacji jest teraz domeną e-maila (AuthService.deriveOrganizationNameFromEmail),
-- więc unikalność wymusza jedną organizację na domenę i zamyka TOCTOU przy
-- równoległej rejestracji dwóch kont z tej samej domeny - ten sam wzorzec co
-- istniejący unikalny "users_email_key".
CREATE UNIQUE INDEX "organizations_name_key" ON "organizations"("name");
