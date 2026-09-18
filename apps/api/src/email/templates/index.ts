// Szablony e-mail żyją w kodzie (nie w panelu dostawcy) - dzięki temu treść
// jest wersjonowana i testowana razem z resztą aplikacji. Wartości z
// templateData mogą pochodzić od użytkownika (imię, nazwa organizacji), więc
// KAŻDA jest escapowana przed wstawieniem do HTML.
export interface RenderedEmail {
  html: string;
  text: string;
}

const PRODUCT_NAME = 'CyberSzkoło';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, bodyHtml: string, button?: { label: string; url: string }): string {
  const cta = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="background:#059669;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(button.label)}</a></p>` +
      `<p style="color:#64748b;font-size:13px">Jeśli przycisk nie działa, skopiuj ten adres do przeglądarki:<br>${escapeHtml(button.url)}</p>`
    : '';
  return (
    `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">` +
    `<h1 style="font-size:20px">${escapeHtml(PRODUCT_NAME)}</h1>` +
    `<h2 style="font-size:17px">${escapeHtml(title)}</h2>${bodyHtml}${cta}` +
    `<p style="color:#94a3b8;font-size:12px;margin-top:32px">Jeśli to nie Ty zainicjowałeś/aś tę wiadomość, zignoruj ją.</p></div>`
  );
}

// Wersja tekstowa nie jest escapowana jak HTML, więc znaki nowej linii/sterujące
// z danych użytkownika mogłyby złamać układ wiadomości - zamieniamy je na spacje.
function plain(value: unknown): string {
  // Zamierzone dopasowanie znaków sterujących (to jest cel tej funkcji).
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

type Renderer = (data: Record<string, unknown>) => RenderedEmail;

const renderers: Record<string, Renderer> = {
  'email-verification': (data) => ({
    html: layout(
      'Potwierdź swój adres e-mail',
      '<p>Dziękujemy za rejestrację. Kliknij przycisk, aby potwierdzić adres e-mail i aktywować konto. Link jest ważny 24 godziny.</p>',
      { label: 'Potwierdź adres e-mail', url: String(data.verificationUrl) },
    ),
    text: `Potwierdź adres e-mail (link ważny 24 godziny): ${String(data.verificationUrl)}`,
  }),
  'password-reset': (data) => ({
    html: layout(
      'Reset hasła',
      '<p>Otrzymaliśmy prośbę o zresetowanie hasła. Link jest ważny 1 godzinę i można go użyć tylko raz.</p>',
      { label: 'Ustaw nowe hasło', url: String(data.resetUrl) },
    ),
    text: `Reset hasła (link ważny 1 godzinę): ${String(data.resetUrl)}`,
  }),
  'user-invite': (data) => {
    const org = plain(data.organizationName ?? 'organizacji');
    const inviter = data.invitedBy ? plain(data.invitedBy) : null;
    const greeting = data.firstName ? `Cześć ${plain(data.firstName)}, ` : '';
    const who = inviter ? ` przez ${inviter}` : '';
    return {
      html: layout(
        `Dodano Cię do organizacji ${org}`,
        `<p>${escapeHtml(greeting)}Twoje konto w organizacji <strong>${escapeHtml(org)}</strong> zostało utworzone${escapeHtml(who)}. ` +
          'Ustaw hasło, aby aktywować konto i rozpocząć szkolenia. Link jest ważny 1 godzinę.</p>',
        { label: 'Aktywuj konto', url: String(data.activationUrl) },
      ),
      text: `${greeting}Dodano Cię do organizacji ${org}${who}. Aktywuj konto (link ważny 1 godzinę): ${String(data.activationUrl)}`,
    };
  },
};

export function renderTemplate(templateName: string, data: Record<string, unknown>): RenderedEmail | null {
  const renderer = renderers[templateName];
  return renderer ? renderer(data) : null;
}
