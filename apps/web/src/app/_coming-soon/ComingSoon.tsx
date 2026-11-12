import Link from 'next/link';
import type { ContentLocale } from '@cyberszkolo/content';

// Strona „w budowie” pod „/” dla niezalogowanych, włączana flagą COMING_SOON=1 (D-157, lib/coming-soon.ts). Komponent serwerowy, bez
// skryptów: język liczy serwer z Accept-Language (D-133, landing-locale.ts), więc HTML z serwera jest od razu w dobrym języku.
// Wideo: autoplay wyciszony, w pętli, ozdobne (aria-hidden); przy prefers-reduced-motion zamiast niego sam plakat (CSS, bez JS).

export const COMING_SOON_TEXT: Record<ContentLocale, { title: string; description: string; heading: string; lead: string; account: string; login: string }> = {
  pl: {
    title: 'Unfooly – wkrótce',
    description: 'Szkolenia z cyberbezpieczeństwa, po których nikt nie da się nabrać. Startujemy wkrótce.',
    heading: 'Strona w budowie. Startujemy wkrótce.',
    lead: 'Szkolenia z cyberbezpieczeństwa, po których nikt nie da się nabrać.',
    account: 'Masz już konto?',
    login: 'Zaloguj się',
  },
  en: {
    title: 'Unfooly – coming soon',
    description: 'Security awareness training that makes your team unfoolable. Launching soon.',
    heading: 'Under construction. Launching soon.',
    lead: 'Security awareness training that makes your team unfoolable.',
    account: 'Already have an account?',
    login: 'Log in',
  },
};

const POSTER = '/coming-soon/unfooly-loader-poster.jpg';

export default function ComingSoon({ locale }: { locale: ContentLocale }) {
  const text = COMING_SOON_TEXT[locale];
  return (
    <div lang={locale} className="flex min-h-dvh items-center justify-center bg-ink px-4 py-6 text-white">
      <main className="flex w-full max-w-[640px] flex-col items-center gap-5 text-center">
        <video
          data-testid="coming-soon-video"
          className="block aspect-video h-auto w-full motion-reduce:hidden"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster={POSTER}
          aria-hidden="true"
        >
          <source src="/coming-soon/unfooly-loader.webm" type="video/webm" />
          <source src="/coming-soon/unfooly-loader.mp4" type="video/mp4" />
        </video>
        {/* eslint-disable-next-line @next/next/no-img-element -- plakat 16:9 z public/, bez optymalizacji next/image (jak w filmie D-091) */}
        <img data-testid="coming-soon-poster" className="hidden aspect-video h-auto w-full motion-reduce:block" src={POSTER} alt="" aria-hidden="true" />
        <h1 className="text-balance text-[clamp(22px,4vw,30px)] font-bold leading-tight tracking-[-0.02em]">{text.heading}</h1>
        <p className="max-w-[46ch] text-base leading-normal text-[#A8A8A2]">{text.lead}</p>
        <p className="max-w-[46ch] text-base leading-normal text-[#A8A8A2]">
          {text.account}{' '}
          <Link
            href="/login"
            className="rounded-sm border-b-2 border-accent pb-px font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            {text.login}
          </Link>
        </p>
      </main>
    </div>
  );
}
