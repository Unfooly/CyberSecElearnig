'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ContentLocale } from '@cyberszkolo/content';
import Card, { CardHeader } from '@/components/ui/Card';
import { LOCALE_LABEL, SUPPORTED_CONTENT_LOCALES, saveContentLocale } from '@/lib/content-locale';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * Język szkoleń w ustawieniach konta (D-133): „Automatycznie (język przeglądarki)” albo jeden z obsługiwanych języków. Zapis od razu przy
 * zmianie, optymistycznie - przy błędzie wybór wraca z komunikatem (jak Dostępność). Przyciski opcji bez `disabled` w trakcie zapisu: fokus
 * zostaje na grupie, a strzałki zmieniają wybór jak zwykle (każda zmiana to zapis; odpowiedź starszego zapisu nie nadpisuje nowszego).
 * Kurs bez wybranego języka pokazuje się po polsku z plakietką „Available in Polish only”.
 */
export default function LanguageSettings({ initialLocale }: { initialLocale: ContentLocale | null }) {
  const router = useRouter();
  const [locale, setLocale] = useState<ContentLocale | null>(initialLocale);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const latest = useRef(0);
  const saved = useRef<ContentLocale | null>(initialLocale);

  async function change(next: ContentLocale | null) {
    const requestId = ++latest.current;
    setLocale(next);
    setMessage(null);
    const status = await saveContentLocale(next);
    if (status === 401) {
      router.push('/login');
      return;
    }
    // Każdy udany zapis to stan serwera (także starszy, który przyszedł po wysłaniu nowszego) - cofnięcie przy błędzie wraca do niego.
    if (status >= 200 && status < 300) saved.current = next;
    if (requestId !== latest.current) return;
    if (status >= 200 && status < 300) {
      setMessage({ tone: 'ok', text: 'Zapisano.' });
    } else {
      setLocale(saved.current);
      setMessage({ tone: 'error', text: 'Nie udało się zapisać ustawienia. Spróbuj ponownie.' });
    }
  }

  const options: { value: ContentLocale | null; label: string; lang?: ContentLocale }[] = [
    { value: null, label: 'Automatycznie (język przeglądarki)' },
    ...SUPPORTED_CONTENT_LOCALES.map((code) => ({ value: code, label: LOCALE_LABEL[code], lang: code })),
  ];

  return (
    <Card className="mt-6">
      <CardHeader title="Język szkoleń" id="language-settings-title" />
      <fieldset className="px-5 py-4" aria-labelledby="language-settings-title" aria-describedby="language-settings-hint">
        <p id="language-settings-hint" className="text-sm text-slate-600">
          Szkolenia, które mają ten język, wyświetlą się w nim. Pozostałe - po polsku.
        </p>
        <div className="mt-2 flex flex-col gap-1" data-testid="content-locale">
          {options.map((option) => (
            <label key={option.value ?? 'auto'} className="flex min-h-[44px] cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="content-locale"
                value={option.value ?? 'auto'}
                checked={locale === option.value}
                onChange={() => void change(option.value)}
                className={`h-5 w-5 shrink-0 accent-accent ${FOCUS_RING}`}
              />
              <span lang={option.lang} className="text-base text-ink">
                {option.label}
              </span>
            </label>
          ))}
        </div>
        <p role="status" className={`mt-1 min-h-[1.25rem] text-sm ${message?.tone === 'error' ? 'text-danger' : 'text-slate-600'}`}>
          {message?.text ?? ''}
        </p>
      </fieldset>
    </Card>
  );
}
