import sanitizeHtml, { IOptions, Tag } from 'sanitize-html';

/** Jedyny dozwolony link w treści maila; w chwili wysyłki podmieniany na jednorazowy link odbiorcy. */
export const TRACKING_LINK_PLACEHOLDER = '{{trackingLink}}';

// Tagi formatujące tekst; bez obrazów (brak zdalnych zasobów i pikseli śledzących), skryptów, formularzy,
// iframe, styli i atrybutów zdarzeń. Treść tagów niebezpiecznych (script/style) jest usuwana w całości.
const BODY_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'blockquote', 'span', 'div', 'hr'];
const LESSON_TAGS = BODY_TAGS.filter((tag) => tag !== 'a');

const COMMON: Pick<IOptions, 'allowedAttributes' | 'disallowedTagsMode' | 'nonTextTags' | 'allowProtocolRelative'> = {
  allowedAttributes: {},
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'template'],
  allowProtocolRelative: false,
};

const BODY_OPTIONS: IOptions = {
  ...COMMON,
  allowedTags: BODY_TAGS,
  // <a> zostaje WYŁĄCZNIE z href równym dokładnie placeholderowi; każdy inny link staje się zwykłym tekstem
  // (span), więc nie da się wstawić własnego adresu (phishing "na prawdę") ani javascript:.
  allowedAttributes: { a: ['href'] },
  allowedSchemes: [],
  transformTags: {
    a: (_tag, attribs): Tag =>
      attribs.href === TRACKING_LINK_PLACEHOLDER
        ? { tagName: 'a', attribs: { href: TRACKING_LINK_PLACEHOLDER } }
        : { tagName: 'span', attribs: {} },
  },
};

const LESSON_OPTIONS: IOptions = {
  ...COMMON,
  allowedTags: LESSON_TAGS,
  // W lekcji nie ma linków wcale - <a> jest usuwane, tekst zostaje.
  transformTags: { a: () => ({ tagName: 'span', attribs: {} }) },
};

/** Sanityzuje treść maila (allow-lista tagów, jedyny link = placeholder). */
export function sanitizeTemplateBody(html: string): string {
  return sanitizeHtml(html, BODY_OPTIONS).trim();
}

/** Sanityzuje treść lekcji ("To była symulacja") - bez linków. */
export function sanitizeLessonHtml(html: string): string {
  return sanitizeHtml(html, LESSON_OPTIONS).trim();
}

// Prawdziwy znacznik <a> z jedynym dozwolonym href (po sanityzacji ma dokładnie taką postać). Szukamy ZNACZNIKA,
// nie samego tekstu href="...": sanitize-html nie escapuje cudzysłowów w tekście, więc zwykły tekst
// `href="{{trackingLink}}"` nie może udawać linku (znak < w tekście jest escapowany do &lt;).
const TRACKING_ANCHOR = /<a href="\{\{trackingLink\}\}">/;

/** Czy (już sanityzowana) treść zawiera link do śledzenia - bez niego kampania nie ma sensu. */
export function hasTrackingLink(sanitizedBody: string): boolean {
  return TRACKING_ANCHOR.test(sanitizedBody);
}
