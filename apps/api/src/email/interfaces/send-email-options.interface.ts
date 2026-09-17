export interface SendEmailOptions {
  to: string;
  subject: string;
  // Alias szablonu zdefiniowanego w panelu Postmark (Templates API) - NIE
  // treść HTML. Zmiana treści maila = zmiana szablonu w Postmarku, nie
  // deploy backendu.
  templateName: string;
  templateData: Record<string, unknown>;
}
