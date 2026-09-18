// Szablony e-mail żyją w kodzie (nie w panelu dostawcy) - dzięki temu treść
// jest wersjonowana i testowana razem z resztą aplikacji. Wartości z
// templateData mogą pochodzić od użytkownika (imię, nazwa organizacji), więc
// KAŻDA jest escapowana przed wstawieniem do HTML.
export interface RenderedEmail {
  html: string;
  text: string;
}

const PRODUCT_NAME = 'Unfooly';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const LOGO_PATH = '/brand/png/unfooly-wordmark-1600.png';
// Proporcje pliku wordmark (855 x 278) - stałe wymiary, bo klienci pocztowi
// nie skalują obrazków z CSS.
const LOGO_WIDTH = 110;
const LOGO_HEIGHT = 36;

export interface TemplateOptions {
  // Publiczny adres aplikacji (FRONTEND_URL) - logo jest serwowane jako PNG
  // z public/brand aplikacji web (klienci pocztowi często nie renderują SVG).
  assetBaseUrl?: string;
}

function layout(
  title: string,
  bodyHtml: string,
  button?: { label: string; url: string },
  options: TemplateOptions = {},
): string {
  const base = options.assetBaseUrl?.replace(/\/+$/, '');
  // Bez publicznego adresu (np. lokalny dev) obrazek i tak by się nie załadował,
  // więc zostaje tekstowy wordmark.
  const brand = base
    ? `<img src="${escapeHtml(base + LOGO_PATH)}" alt="${escapeHtml(PRODUCT_NAME)}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" style="display:block;border:0;height:${LOGO_HEIGHT}px;width:${LOGO_WIDTH}px">`
    : `<span style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#131313">${escapeHtml(PRODUCT_NAME.toLowerCase())}<span style="color:#6C5CE7">.</span></span>`;
  const cta = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#6C5CE7;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">${escapeHtml(button.label)}</a></p>` +
      `<p style="color:#6F6F6B;font-size:13px;line-height:1.5">Jeśli przycisk nie działa, skopiuj ten adres do przeglądarki:<br><a href="${escapeHtml(button.url)}" style="color:#3F32B5;word-break:break-all">${escapeHtml(button.url)}</a></p>`
    : '';
  return (
    `<div style="background:#F6F6F4;padding:32px 16px;font-family:'Plus Jakarta Sans',-apple-system,'Segoe UI',Arial,sans-serif;color:#131313">` +
    `<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #E6E6E2;border-radius:16px;padding:32px">` +
    `<div style="margin-bottom:24px">${brand}</div>` +
    `<h2 style="font-size:20px;font-weight:800;letter-spacing:-0.01em;margin:0 0 12px">${escapeHtml(title)}</h2>` +
    `<div style="font-size:14px;line-height:1.5">${bodyHtml}</div>${cta}` +
    `<p style="color:#9A9A96;font-size:12px;margin:32px 0 0;border-top:1px solid #E6E6E2;padding-top:16px">Jeśli to nie Ty zainicjowałeś/aś tę wiadomość, zignoruj ją.</p>` +
    `</div></div>`
  );
}

// Wersja tekstowa nie jest escapowana jak HTML, więc znaki nowej linii/sterujące
// z danych użytkownika mogłyby złamać układ wiadomości - zamieniamy je na spacje.
function plain(value: unknown): string {
  // Zamierzone dopasowanie znaków sterujących (to jest cel tej funkcji).
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

type Renderer = (data: Record<string, unknown>, options: TemplateOptions) => RenderedEmail;

const renderers: Record<string, Renderer> = {
  'email-verification': (data, options) => ({
    html: layout(
      'Potwierdź swój adres e-mail',
      '<p>Dziękujemy za rejestrację. Kliknij przycisk, aby potwierdzić adres e-mail i aktywować konto. Link jest ważny 24 godziny.</p>',
      { label: 'Potwierdź adres e-mail', url: String(data.verificationUrl) }, options,
    ),
    text: `Potwierdź adres e-mail (link ważny 24 godziny): ${String(data.verificationUrl)}`,
  }),
  'password-reset': (data, options) => ({
    html: layout(
      'Reset hasła',
      '<p>Otrzymaliśmy prośbę o zresetowanie hasła. Link jest ważny 1 godzinę i można go użyć tylko raz.</p>',
      { label: 'Ustaw nowe hasło', url: String(data.resetUrl) }, options,
    ),
    text: `Reset hasła (link ważny 1 godzinę): ${String(data.resetUrl)}`,
  }),
  'demo-request': (data, options) => ({
    html: layout(
      'Nowa prośba o demo',
      `<p>Służbowy e-mail: <strong>${escapeHtml(data.email)}</strong><br>Liczba pracowników: <strong>${escapeHtml(data.employeeCount)}</strong></p>` +
        '<p>Odpisz w ciągu 1 dnia roboczego.</p>',
      undefined,
      options,
    ),
    text: `Nowa prośba o demo. E-mail: ${plain(data.email)}, liczba pracowników: ${plain(data.employeeCount)}`,
  }),
  'user-invite': (data, options) => {
    const org = plain(data.organizationName ?? 'organizacji');
    const inviter = data.invitedBy ? plain(data.invitedBy) : null;
    const greeting = data.firstName ? `Cześć ${plain(data.firstName)}, ` : '';
    const who = inviter ? ` przez ${inviter}` : '';
    return {
      html: layout(
        `Dodano Cię do organizacji ${org}`,
        `<p>${escapeHtml(greeting)}Twoje konto w organizacji <strong>${escapeHtml(org)}</strong> zostało utworzone${escapeHtml(who)}. ` +
          'Ustaw hasło, aby aktywować konto i rozpocząć szkolenia. Link jest ważny 1 godzinę.</p>',
        { label: 'Aktywuj konto', url: String(data.activationUrl) }, options,
      ),
      text: `${greeting}Dodano Cię do organizacji ${org}${who}. Aktywuj konto (link ważny 1 godzinę): ${String(data.activationUrl)}`,
    };
  },
};

export function renderTemplate(
  templateName: string,
  data: Record<string, unknown>,
  options: TemplateOptions = {},
): RenderedEmail | null {
  const renderer = renderers[templateName];
  return renderer ? renderer(data, options) : null;
}
