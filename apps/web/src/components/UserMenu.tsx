'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';
import AvatarDisplay from '@/app/courses/_components/AvatarDisplay';
import { useLogout } from '@/lib/use-logout';

/**
 * Czy urządzenie ma prawdziwy hover (mysz, touchpad). Na dotyku tapnięcie daje
 * `mouseenter` ORAZ `click`, więc bez tego sprawdzenia menu otworzyłoby się
 * najechaniem i natychmiast zamknęło klikiem.
 */
function hasHover(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches === true;
}

// Menu użytkownika w Topbarze (klik w avatar). Dziś jedna pozycja - wylogowanie;
// wcześniej wylogować się dało tylko z uproszczonego PendingHeader, więc zalogowany
// użytkownik ACTIVE nie miał do tego żadnego przycisku w interfejsie.
export default function UserMenu({
  userEmail,
  avatarUrl,
  initials,
}: {
  userEmail: string;
  avatarUrl: string | null;
  initials: string;
}) {
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const { logout, isLoggingOut } = useLogout();

  // Menu zamyka się przy kliknięciu poza nim, Escape i wyjściu fokusem (Tab) poza
  // kontener - inaczej użytkownik klawiatury zostawia za sobą wiszący dropdown.
  // pointerdown, nie click: menu ma zniknąć też wtedy, gdy klik trafia w link pod nim.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
        // Fokus wraca na przycisk - inaczej po zamknięciu klawiaturą ląduje na <body>.
        triggerRef.current?.focus();
      }
    }
    function handleFocusOut(event: FocusEvent) {
      // relatedTarget === null (np. przełączenie karty przeglądarki) też zamyka.
      if (!containerRef.current?.contains(event.relatedTarget as Node | null)) {
        setIsOpen(false);
      }
    }
    // Węzeł zapamiętany na czas efektu - w sprzątaniu containerRef.current może już być null.
    const container = containerRef.current;
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    container?.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      container?.removeEventListener('focusout', handleFocusOut);
    };
  }, [isOpen]);

  async function handleLogout() {
    await logout();
    setIsOpen(false);
  }

  return (
    // Najechanie wskaźnikiem rozwija menu; klik nadal przełącza (klawiatura i dotyk nie mają hoveru).
    <div
      ref={containerRef}
      className="relative shrink-0"
      onMouseEnter={() => hasHover() && setIsOpen(true)}
      onMouseLeave={() => hasHover() && setIsOpen(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label="Menu użytkownika"
        className="flex h-10 items-center gap-2.5 rounded-btn px-1.5 text-muted hover:bg-paper focus:outline-none focus:ring-2 focus:ring-accent-soft"
      >
        {/* Bez avatara AvatarDisplay rysuje inicjały w tych samych klasach - jeden punkt prawdy o wyglądzie. */}
        <AvatarDisplay
          avatarUrl={avatarUrl}
          size="sm"
          initials={initials}
          label={avatarUrl ? 'Twój avatar' : undefined}
        />
        {/* Adresu nie ma w pasku (długi bywał ucinany wielokropkiem) - pełny jest w menu. */}
        <ChevronDown size={16} strokeWidth={2.5} aria-hidden="true" className={isOpen ? 'rotate-180' : undefined} />
      </button>

      {isOpen && (
        // Odstęp od paska robi PADDING opakowania, nie margines karty: przerwa między
        // avatarem a menu zostaje wtedy wewnątrz kontenera i przejazd myszą jej nie zamyka.
        <div className="absolute right-0 top-full z-50 pt-2">
          <div
            id={menuId}
            role="menu"
            aria-label="Menu użytkownika"
            className="w-60 rounded-card border border-border bg-surface py-1.5 shadow-card"
          >
            {/* Adresu nie ma już w pasku - tu widać go zawsze, w całości. */}
            <p className="break-all border-b border-border px-3 pb-2 pt-1 text-[13px] font-semibold text-muted">{userEmail}</p>
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-ink hover:bg-paper disabled:cursor-default disabled:opacity-50"
            >
              <LogOut size={16} strokeWidth={2} aria-hidden="true" />
              {isLoggingOut ? 'Wylogowywanie...' : 'Wyloguj'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
