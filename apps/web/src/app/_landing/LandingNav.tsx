'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { Menu, X } from 'lucide-react';
import Logo from '@/components/Logo';
import { ButtonLink } from '@/components/ui/Button';
import { WRAP } from './layout-constants';

const SECTION_LINKS = [
  { href: '#produkt', label: 'Produkt' },
  { href: '#jak', label: 'Jak to działa' },
  { href: '#funkcje', label: 'Funkcje' },
  { href: '#cennik', label: 'Cennik' },
];

// Panel rozwijany PONIŻEJ paska (feat/mobile-landing-nav), nie drawer jak w apps/web/src/components/Topbar.tsx:
// wchodzi w zwykły przepływ dokumentu (przesuwa treść pod spodem w dół), więc bez tła i bez pułapki fokusu -
// Tab po ostatnim linku panelu przechodzi dalej w naturalny sposób do sekcji Hero, tak jak przy zwykłym
// rozwijaniu treści na stronie.
export function LandingNav() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const headerRef = useRef<HTMLElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (open) {
      firstLinkRef.current?.focus();
    }
  }, [open]);

  function closePanel() {
    setOpen(false);
  }

  // Escape na klawiaturze WEWNĄTRZ headera (nie document - header nie ma pułapki fokusu, więc Tab spokojnie
  // wychodzi dalej w stronę; Escape naciśnięty tam, np. żeby zamknąć podpowiedzi przeglądarki w DemoForm, nie
  // powinien nagle zamykać panelu i porywać fokusu z powrotem na hamburger - code review PR #42).
  function handleHeaderKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && open) {
      setOpen(false);
      hamburgerRef.current?.focus();
    }
  }

  // Header jest sticky - otwarty panel zostawiony "za sobą" (fokus/klik poza headerem, np. Tab w Hero) zasłaniałby
  // treść pod nim zamiast tylko ją przesuwać (code review PR #42, WCAG 2.4.11). Zamyka BEZ przenoszenia fokusu -
  // użytkownik już go przeniósł gdzie indziej.
  function handleHeaderBlur(event: FocusEvent<HTMLElement>) {
    if (open && (!event.relatedTarget || !headerRef.current?.contains(event.relatedTarget as Node))) {
      setOpen(false);
    }
  }

  return (
    <header
      ref={headerRef}
      onKeyDown={handleHeaderKeyDown}
      onBlur={handleHeaderBlur}
      className="sticky top-0 z-40 border-b border-border bg-paper/90 backdrop-blur"
    >
      <div className={`${WRAP} flex h-[72px] items-center gap-6 sm:gap-10`}>
        <Link href="/" aria-label="Unfooly - strona główna" className="shrink-0">
          <Logo variant="dark" height={28} />
        </Link>
        <nav aria-label="Sekcje strony" className="hidden flex-1 gap-7 text-[15px] font-semibold text-muted md:flex">
          {SECTION_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="hover:text-ink">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          {/* Poniżej md "Zaloguj się" przenosi się do rozwijanego panelu - w pasku zostają tylko logo, "Umów demo"
              i hamburger, żeby pasek na telefonie nie był przeciążony. */}
          <ButtonLink href="/login" variant="ghost" className="hidden text-ink hover:bg-transparent hover:underline md:inline-flex">
            Zaloguj się
          </ButtonLink>
          <ButtonLink href="#demo" size="sm" className="h-10">
            Umów demo
          </ButtonLink>
          <button
            ref={hamburgerRef}
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? 'Zamknij menu' : 'Otwórz menu'}
            aria-expanded={open}
            aria-controls={panelId}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn text-muted hover:bg-paper focus:outline-none focus:ring-2 focus:ring-accent-soft md:hidden"
          >
            {open ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div id={panelId} className="border-t border-border bg-paper md:hidden">
          <nav aria-label="Sekcje strony (telefon)" className={`${WRAP} flex flex-col gap-1 py-3`}>
            {SECTION_LINKS.map((link, index) => (
              <a
                key={link.href}
                ref={index === 0 ? firstLinkRef : undefined}
                href={link.href}
                onClick={closePanel}
                className="rounded-btn px-2 py-2.5 text-[15px] font-semibold text-muted hover:bg-surface hover:text-ink"
              >
                {link.label}
              </a>
            ))}
            <Link
              href="/login"
              onClick={closePanel}
              className="rounded-btn px-2 py-2.5 text-[15px] font-semibold text-accent-ink hover:bg-surface"
            >
              Zaloguj się
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
