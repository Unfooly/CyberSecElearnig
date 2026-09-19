import { LOCAL_PART_REGEX } from './dto/template.dto';
import { PhishingMailMessage } from './transport/phishing-mail-transport';
import { TRACKING_LINK_PLACEHOLDER } from './template-sanitizer';

export interface TemplateSnapshot {
  subject: string;
  bodyHtml: string;
  senderName: string;
  senderLocalPart: string;
}

// Token odbiorcy: 32 losowe bajty w base64url (43 znaki) - bezpieczny w ścieżce URL, nie wymaga escapowania.
const RECIPIENT_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const RECIPIENT_EMAIL = /^[^\s,;<>"'()[\]\\@\p{Cc}\p{Cf}]{1,64}@[^\s,;<>"'()[\]\\@\p{Cc}\p{Cf}]{1,255}$/u;
export const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Publiczny adres linku odbiorcy: <baza strony lądowania>/t/<token>. Na produkcji wymagane https. */
export function buildTrackingUrl(landingBaseUrl: string, rawToken: string, production: boolean): string {
  if (!RECIPIENT_TOKEN.test(rawToken)) {
    throw new Error('Nieprawidłowy token odbiorcy.');
  }
  const base = new URL(landingBaseUrl);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && !production)) {
    throw new Error('Adres strony lądowania musi używać https (na produkcji).');
  }
  return `${base.origin}/t/${rawToken}`;
}

const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/** Wersja tekstowa maila: linki jako "tekst (adres)", akapity i listy zachowane, bez znaczników. */
export function htmlToText(html: string): string {
  return html
    .replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, (_m, href: string, text: string) => `${text.replace(/<[^>]+>/g, '')} (${href.replace(/&amp;/g, '&')})`)
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/(p|div|h2|h3|blockquote|ul|ol)>/g, '\n\n')
    .replace(/<li>/g, '- ')
    .replace(/<\/li>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Składa wiadomość symulacji ze snapshotu szablonu.
 * - Nadawca: część lokalna z szablonu + ZAWSZE nasza domena (senderDomain z konfiguracji) - domeny nie da się
 *   podać w szablonie; część lokalna jest ponownie walidowana (snapshot pochodzi z bazy).
 * - HTML: jedyny link to adres odbiorcy (placeholder z sanitizera jest podmieniany); po złożeniu sprawdzamy,
 *   że KAŻDY href w wiadomości to dokładnie ten adres.
 * - Temat: bez znaków sterujących (nagłówek).
 */
export function composePhishingMail(input: {
  template: TemplateSnapshot;
  recipientEmail: string;
  trackingUrl: string;
  senderDomain: string;
}): PhishingMailMessage {
  const { template, recipientEmail, trackingUrl, senderDomain } = input;
  if (!LOCAL_PART_REGEX.test(template.senderLocalPart)) {
    throw new Error('Nieprawidłowa część lokalna adresu nadawcy.');
  }
  if (!HOSTNAME.test(senderDomain)) {
    throw new Error('Nieprawidłowa domena nadawcy.');
  }
  // Ostatnia linia obrony: dokładnie jeden adres, bez list, nazw ani znaków sterujących (transport SMTP parsuje adres).
  if (!RECIPIENT_EMAIL.test(recipientEmail)) {
    throw new Error('Nieprawidłowy adres odbiorcy.');
  }

  const safeUrl = escapeAttribute(trackingUrl);
  const body = template.bodyHtml.split(`href="${TRACKING_LINK_PLACEHOLDER}"`).join(`href="${safeUrl}"`);
  // Tylko atrybuty w ZNACZNIKACH: tekst "href=..." wpisany jako treść (sanityzer escapuje < i >, ale nie cudzysłowy)
  // nie jest linkiem i nie może zatrzymać wysyłki. Nawet gdyby coś przemyciło href inaczej zapisany, nie przejdzie.
  const hrefs = [...body.matchAll(/<[a-z][^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map((match) => match[1] ?? match[2] ?? match[3]);
  if (hrefs.length === 0 || hrefs.some((href) => href !== safeUrl)) {
    throw new Error('Treść wiadomości zawiera niedozwolony link.');
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
  return {
    toEmail: recipientEmail,
    fromEmail: `${template.senderLocalPart}@${senderDomain}`,
    // Pusta nazwa po oczyszczeniu => część lokalna adresu (nigdy pusty nagłówek From).
    fromName: template.senderName.replace(/[\p{Cc}\p{Cf}<>"]/gu, '').trim() || template.senderLocalPart,
    // Cięcie po punktach kodowych, nie jednostkach UTF-16 (nie rozrywa pary zastępczej, np. emoji).
    subject: Array.from(template.subject.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim()).slice(0, 200).join(''),
    html,
    text: htmlToText(body),
  };
}
