import type { ReactNode } from 'react';
import { formatYear } from '@/lib/datetime';
import {
  ArrowRight,
  BarChart3,
  Check,
  Clock,
  Flag,
  Globe,
  Mail,
  Play,
  Route,
  ShieldCheck,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Logo from '@/components/Logo';
import { ButtonLink } from '@/components/ui/Button';
import Pill from '@/components/ui/Pill';
import { LANDING_PRICING } from '@/lib/landing-config';
import DashboardPreview from './DashboardPreview';
import DemoForm from './DemoForm';
import { WRAP } from './layout-constants';

export { LandingNav } from './LandingNav';

const H2 = 'text-[30px] font-extrabold leading-[1.12] tracking-[-0.03em] sm:text-[36px] lg:text-[40px]';
const LEAD = 'text-lg text-muted sm:text-xl';
// Większe przyciski niż w aplikacji (mockup landingu: 56 px / 48 px).
const BTN_LG = 'h-14 rounded-[14px] px-7 text-base';

function Eyebrow({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.12em] ${
        light ? 'text-[#B8AEFF]' : 'text-accent-ink'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${light ? 'bg-[#B8AEFF]' : 'bg-accent'}`} aria-hidden="true" />
      {children}
    </span>
  );
}

function SectionHead({ eyebrow, title, lead, center = false }: { eyebrow: string; title: string; lead?: string; center?: boolean }) {
  return (
    <div className={`mb-12 flex max-w-[720px] flex-col gap-3.5 ${center ? 'mx-auto items-center text-center' : ''}`}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className={H2}>{title}</h2>
      {lead && <p className={LEAD}>{lead}</p>}
    </div>
  );
}

function IconBox({ icon: Icon, dark = false }: { icon: LucideIcon; dark?: boolean }) {
  return (
    <span
      className={`flex h-11 w-11 items-center justify-center rounded-xl ${dark ? 'bg-[#2A2A2A] text-white' : 'bg-accent-soft text-accent-ink'}`}
      aria-hidden="true"
    >
      <Icon size={22} strokeWidth={2} />
    </span>
  );
}

const HERO_POINTS = ['Start w 1 dzień', 'Import zespołu z CSV', 'Dane w UE, zgodność z RODO'];

export function Hero() {
  return (
    <section className={`${WRAP} grid items-center gap-12 pb-16 pt-12 lg:grid-cols-[minmax(0,1fr)_520px] lg:gap-16 lg:pt-[88px]`}>
      <div className="flex flex-col gap-7">
        <Eyebrow>Security awareness dla firm</Eyebrow>
        <h1 className="text-[40px] font-extrabold leading-[1.05] tracking-[-0.035em] sm:text-[52px] lg:text-[64px]">
          Pracownicy, których nie da się <span className="text-accent">nabrać</span>.
        </h1>
        <p className={LEAD}>
          Unfooly to platforma krótkich szkoleń z cyberbezpieczeństwa i symulacji phishingu. Zespół uczy się w kilkanaście
          minut, a Ty dostajesz raport, który możesz pokazać zarządowi i audytorowi.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink href="#demo" className={BTN_LG}>
            Umów 20-minutowe demo <ArrowRight size={18} strokeWidth={2.4} aria-hidden="true" />
          </ButtonLink>
          <ButtonLink href="#jak" variant="secondary" className={BTN_LG}>
            <Play size={18} strokeWidth={2.2} aria-hidden="true" /> Zobacz, jak to działa
          </ButtonLink>
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-3 text-sm font-semibold text-muted">
          {HERO_POINTS.map((point) => (
            <li key={point} className="inline-flex items-center gap-2">
              <Check size={18} strokeWidth={2.6} className="text-success" aria-hidden="true" />
              {point}
            </li>
          ))}
        </ul>
      </div>
      <DashboardPreview />
    </section>
  );
}

export function WhySection() {
  return (
    <section id="produkt" className="scroll-mt-20 py-16 lg:py-[104px]">
      <div className={WRAP}>
        <SectionHead
          eyebrow="Dlaczego Unfooly"
          title="Szkolenie, które ludzie kończą. Raport, któremu zarząd wierzy."
          lead="Coroczna prezentacja o phishingu nie zmienia nawyków. Zmieniają je krótkie kursy, praktyczne testy i widoczny postęp."
        />
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          <article className="flex flex-col gap-3.5 rounded-[20px] border border-border bg-surface p-7 shadow-card">
            <IconBox icon={Clock} />
            <h3 className="text-xl font-bold leading-[1.3] tracking-[-0.01em]">Mikroszkolenia 5–12 minut</h3>
            <p className="text-[15px] text-muted">
              Kursy w małych porcjach, z quizem na końcu i punktami XP. Pracownik widzi swój poziom, odznaki i miejsce w
              rankingu, więc wraca sam, bez przypominania.
            </p>
          </article>
          <article className="flex flex-col gap-3.5 rounded-[20px] border border-border bg-surface p-7 shadow-card">
            <IconBox icon={Mail} />
            <h3 className="text-xl font-bold leading-[1.3] tracking-[-0.01em]">Symulacje phishingu</h3>
            <p className="text-[15px] text-muted">
              Realistyczne kampanie e-mail, które testują odruch „stop, zanim kliknę”. Kto kliknął, dostaje krótką lekcję od
              razu, a nie za pół roku. <Pill tone="off">Wkrótce</Pill>
            </p>
          </article>
          <article className="flex flex-col gap-3.5 rounded-[20px] border border-ink bg-ink p-7 text-white shadow-card md:col-span-2 lg:col-span-1">
            <IconBox icon={BarChart3} dark />
            <h3 className="text-xl font-bold leading-[1.3] tracking-[-0.01em]">Raporty dla zarządu i audytora</h3>
            <p className="text-[15px] text-[#B9B9B3]">
              Ukończenie według działów, zaległości, trend w czasie. Gotowy dowód szkoleń pod NIS2 i ISO 27001, do pobrania
              jednym kliknięciem.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    title: 'Zaproś zespół',
    text: 'Wgraj plik CSV albo zaproś ludzi e-mailem. Podziel ich na działy i przypisz role: administrator, menedżer działu, pracownik.',
  },
  {
    title: 'Przypisz ścieżkę nauki',
    text: 'Wybierz kursy obowiązkowe i termin. Każdy pracownik widzi swoją ścieżkę krok po kroku, a przypomnienia wychodzą automatycznie.',
  },
  {
    title: 'Mierz i raportuj',
    text: 'Dashboard pokazuje ukończenie w czasie rzeczywistym. Eksportujesz raport dla zarządu, audytora albo ubezpieczyciela.',
  },
];

export function HowSection() {
  return (
    <section id="jak" className="scroll-mt-20 py-14 lg:py-[72px]">
      <div className={WRAP}>
        <SectionHead eyebrow="Jak to działa" title="Trzy kroki do zespołu, który nie klika w byle co" center />
        <ol className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-3 rounded-[20px] border border-border bg-surface p-7">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-[15px] font-extrabold text-white" aria-hidden="true">
                {index + 1}
              </span>
              <h3 className="text-xl font-bold leading-[1.3] tracking-[-0.01em]">{step.title}</h3>
              <p className="text-[15px] text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const FEATURES: { title: string; text: string; icon: LucideIcon; soon?: boolean }[] = [
  {
    title: 'Ścieżki nauki',
    icon: Route,
    text: 'Kursy obowiązkowe i dodatkowe, terminy, kolejność kroków. Osobna ścieżka dla nowych pracowników.',
  },
  {
    title: 'Gamifikacja',
    icon: Trophy,
    text: 'XP, poziomy, odznaki i ranking organizacji. Certyfikat po ukończeniu ścieżki, do pobrania przez pracownika.',
  },
  {
    title: 'Zespół i działy',
    icon: Users,
    text: 'Import z CSV, zaproszenia e-mail, role i działy. Menedżer widzi tylko swój zespół, administrator całą firmę.',
  },
  {
    title: 'Kampanie phishingowe',
    icon: Mail,
    soon: true,
    text: 'Szablony realnych ataków, harmonogram kampanii, klikalność i zgłaszalność w raporcie.',
  },
  {
    title: 'Zgłaszanie e-maili',
    icon: Flag,
    soon: true,
    text: 'Przycisk „to phishing” w skrzynce pracownika i kolejka zgłoszeń dla działu IT.',
  },
  {
    title: 'Wiele organizacji',
    icon: Globe,
    text: 'Jedno konto partnera, wiele firm klientów. Osobne dane, osobne raporty, jeden panel do zarządzania.',
  },
];

export function FeaturesSection() {
  return (
    <section id="funkcje" className="scroll-mt-20 py-16 lg:py-[104px]">
      <div className={WRAP}>
        <SectionHead eyebrow="Funkcje" title="Wszystko, czego potrzebuje program security awareness" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ title, text, icon: Icon, soon }) => (
            <article key={title} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-[22px]">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex flex-wrap items-center gap-2 text-[17px] font-bold leading-[1.3]">
                  {title} {soon && <Pill tone="off">Wkrótce</Pill>}
                </h3>
                <Icon size={22} strokeWidth={2} className="shrink-0 text-accent-ink" aria-hidden="true" />
              </div>
              <p className="text-sm text-muted">{text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const COMPLIANCE_POINTS = [
  ['NIS2', 'art. 20 i 21: szkolenia kadry i pracowników'],
  ['ISO 27001', 'kontrola A.6.3: świadomość, edukacja i szkolenia'],
  ['RODO', 'dane w UE, umowa powierzenia w standardzie'],
  ['Ubezpieczenie cyber', 'raport jako załącznik do wniosku'],
];

export function ComplianceBand() {
  return (
    <section className="py-14 lg:py-[72px]">
      <div className={WRAP}>
        <div className="grid gap-10 rounded-[28px] bg-ink p-8 text-white sm:p-12 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center lg:gap-12 lg:p-16">
          <div className="flex flex-col gap-5">
            <Eyebrow light>Zgodność</Eyebrow>
            <h2 className={`${H2} text-white`}>Szkolenie pracowników to obowiązek. Unfooly robi z niego dowód.</h2>
            <p className="text-lg text-[#B9B9B3]">
              NIS2 i ISO 27001 wymagają regularnych szkoleń z cyberbezpieczeństwa i ich dokumentowania. Zamiast listy
              obecności w Excelu dostajesz raport z datami, wynikami i podpisem cyfrowym platformy.
            </p>
          </div>
          <ul className="flex flex-col gap-3.5">
            {COMPLIANCE_POINTS.map(([name, text]) => (
              <li key={name} className="flex items-start gap-3 font-semibold">
                <ShieldCheck size={22} strokeWidth={2} className="mt-0.5 shrink-0 text-[#7FE0C3]" aria-hidden="true" />
                <span>
                  <b>{name}</b> — {text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const AUDIENCE = [
  {
    title: 'Małe i średnie firmy',
    tone: 'bg-accent-soft',
    text: 'Bez działu bezpieczeństwa. Uruchamiasz w jeden dzień, platforma pilnuje reszty: przypomnienia, terminy, raport na koniec kwartału.',
  },
  {
    title: 'Firmy pod NIS2 i ISO',
    tone: 'bg-success-soft',
    text: 'Potrzebujesz dowodu szkoleń dla audytora. Dostajesz go w formacie, który da się załączyć do dokumentacji.',
  },
  {
    title: 'Partnerzy IT i MSP',
    tone: 'bg-warning-soft',
    text: 'Obsługujesz wielu klientów. Jedno konto, wiele organizacji, osobne raporty. Sprzedajesz szkolenia jako usługę pod własną opieką.',
  },
];

export function AudienceSection() {
  return (
    <section className="py-16 lg:py-[104px]">
      <div className={WRAP}>
        <SectionHead eyebrow="Dla kogo" title="Od 20 do 2000 pracowników" />
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {AUDIENCE.map((item) => (
            <article key={item.title} className={`flex flex-col gap-2.5 rounded-[20px] p-7 ${item.tone}`}>
              <h3 className="text-xl font-bold leading-[1.3] tracking-[-0.01em]">{item.title}</h3>
              <p className="text-[15px] opacity-75">{item.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const PRICE_FEATURES = [
  'Wszystkie kursy i ścieżki',
  'Nielimitowani administratorzy',
  'Raporty i eksport',
  'Import CSV i zaproszenia',
  'Gamifikacja i certyfikaty',
  'Wsparcie e-mail w dni robocze',
];

export function PricingSection() {
  const { pricePerEmployeeMonthly, smallTeamAnnualFee, smallTeamThreshold } = LANDING_PRICING;
  return (
    <section id="cennik" className="scroll-mt-20 py-14 lg:py-[72px]">
      <div className={WRAP}>
        <SectionHead eyebrow="Cennik" title="Jedna cena za pracownika. Bez ukrytych modułów." />
        <div className="grid gap-8 rounded-3xl border border-border bg-surface p-6 shadow-card sm:p-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10">
          <div className="flex flex-col gap-6">
            <div>
              <div className="text-[44px] font-extrabold leading-none tracking-[-0.04em] sm:text-[56px]">
                {pricePerEmployeeMonthly} zł
                <small className="ml-1.5 text-base font-semibold tracking-normal text-muted">/ pracownik / miesiąc</small>
              </div>
              <p className="mt-2 text-sm text-muted">
                Rozliczenie roczne. Poniżej {smallTeamThreshold} osób: stała opłata {smallTeamAnnualFee} zł / rok.
              </p>
            </div>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {PRICE_FEATURES.map((feature) => (
                <li key={feature} className="flex items-center gap-2.5 text-[15px] font-semibold">
                  <Check size={18} strokeWidth={2.6} className="shrink-0 text-success" aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted">
              Kampanie phishingowe i zgłaszanie e-maili dołączą do planu bez dopłaty po premierze modułu.
            </p>
          </div>
          <DemoForm />
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="py-16 lg:py-[104px]">
      <div className={`${WRAP} flex flex-col items-center gap-5 text-center`}>
        <h2 className={`${H2} max-w-[800px]`}>Zrób z zespołu pierwszą linię obrony, a nie najsłabsze ogniwo.</h2>
        <p className={LEAD}>Pierwsza ścieżka nauki gotowa w 24 godziny od podpisania umowy.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <ButtonLink href="#demo" className={BTN_LG}>
            Umów demo <ArrowRight size={18} strokeWidth={2.4} aria-hidden="true" />
          </ButtonLink>
          <ButtonLink href="#demo" variant="secondary" className={BTN_LG}>
            Napisz do nas
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-border py-10 text-sm text-muted">
      <div className={`${WRAP} flex flex-col gap-6 md:flex-row md:items-center md:justify-between`}>
        <div className="flex flex-col gap-1.5">
          <Logo variant="dark" height={28} />
          <span>Unfooly (an-FU-li) — nie do nabrania.</span>
        </div>
        <nav aria-label="Stopka" className="flex flex-wrap gap-x-5 gap-y-2 font-semibold">
          <a href="#produkt" className="hover:text-ink">Produkt</a>
          <a href="#cennik" className="hover:text-ink">Cennik</a>
          <a href="#demo" className="hover:text-ink">Kontakt</a>
          <a href="/regulamin" className="hover:text-ink">Regulamin</a>
          <a href="/polityka-prywatnosci" className="hover:text-ink">Polityka prywatności</a>
          <a href="/bezpieczenstwo" className="hover:text-ink">Bezpieczeństwo</a>
        </nav>
        <span>© {formatYear()} Unfooly</span>
      </div>
    </footer>
  );
}
