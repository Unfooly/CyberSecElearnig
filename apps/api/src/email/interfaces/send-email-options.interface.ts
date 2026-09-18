export interface SendEmailOptions {
  to: string;
  subject: string;
  // Nazwa szablonu z apps/api/src/email/templates (render w kodzie) - NIE
  // treść HTML. Zmiana treści maila = zmiana szablonu w kodzie i
  // deploy backendu.
  templateName: string;
  templateData: Record<string, unknown>;
}
