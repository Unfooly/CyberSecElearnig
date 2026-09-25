'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, LogOut, Settings } from 'lucide-react';
import AvatarDisplay from '@/app/courses/_components/AvatarDisplay';
import { useLogout } from '@/lib/use-logout';

// Menu użytkownika w Topbarze (klik w avatar). Dziś jedna pozycja - wylogowanie;
// wcześniej wylogować się dało tylko z uproszczonego PendingHeader, więc zalogowany
// użytkownik ACTIVE nie miał do tego żadnego przycisku w interfejsie.
export default function UserMenu({
  userEmail,
  avatarUrl,
  initials,
  onOpenChange,
  forceClose,
}: {
  userEmail: string;
  avatarUrl: string | null;
  initials: string;
  /** Wołane przy zmianach stanu (otwarcie i zamknięcie; przy zamknięciu czasem dwukrotnie - np. pointerdown i
      następujący po nim focusout - to nieszkodliwe, wywołujący nie powinien zakładać dokładnie jednego wywołania
      na przejście) - Topbar używa tego, żeby zamknąć panel mobilny, gdy to menu się otwiera (oba nie mogą być
      otwarte naraz - kod review PR #39, punkt 2: dropdown tego menu i panel dzielą tę samą kolumnę z prawej,
      dropdown (z-50 w kontekście nakładania headera) i tak ląduje POD panelem). */
  onOpenChange?: (open: boolean) => void;
  /** Gdy zmieni się na true, a menu jest otwarte - zamyka je (odwrotny kierunek: panel mobilny się otwiera). */
  forceClose?: boolean;
}) {
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const { logout, isLoggingOut } = useLogout();

  const close = useCallback(() => {
    setIsOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (forceClose && isOpen) {
      close();
    }
  }, [forceClose, isOpen, close]);

  // Menu zamyka się przy kliknięciu poza nim, Escape i wyjściu fokusem (Tab) poza
  // kontener - inaczej użytkownik klawiatury zostawia za sobą wiszący dropdown.
  // pointerdown, nie click: menu ma zniknąć też wtedy, gdy klik trafia w link pod nim.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        close();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close();
        // Fokus wraca na przycisk - inaczej po zamknięciu klawiaturą ląduje na <body>.
        triggerRef.current?.focus();
      }
    }
    function handleFocusOut(event: FocusEvent) {
      // relatedTarget === null (np. przełączenie karty przeglądarki) też zamyka.
      if (!containerRef.current?.contains(event.relatedTarget as Node | null)) {
        close();
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
  }, [isOpen, close]);

  async function handleLogout() {
    await logout();
    close();
  }

  return (
    // Menu otwiera wyłącznie klik (decyzja właściciela produktu 2026-09-22): hover otwierałby je
    // przy zwykłym przejeździe myszą przez pasek, a na dotyku i klawiaturze i tak go nie ma.
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          // NIE funkcyjny updater setIsOpen(open => ...) - w StrictMode/React 18 updater bywa wywoływany poza
          // przebiegiem commitu (albo dwa razy w StrictMode), a efekt uboczny (onOpenChange, czyli setDrawerOpen w
          // Topbar) w środku takiego wywołania ryzykuje aktualizacją rodzica w trakcie renderu dziecka. Zwykłe
          // domknięcie na `isOpen` wystarcza - ten handler i tak tworzy się na nowo przy każdym renderze, więc
          // zawsze widzi aktualną wartość (kod review PR #39, drobiazgi).
          const next = !isOpen;
          setIsOpen(next);
          onOpenChange?.(next);
        }}
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
        <div
          id={menuId}
          role="menu"
          aria-label="Menu użytkownika"
          className="absolute right-0 top-full z-50 mt-2 w-60 rounded-card border border-border bg-surface py-1.5 shadow-card"
        >
          {/* Adresu nie ma już w pasku - tu widać go zawsze, w całości. */}
          <p className="break-all border-b border-border px-3 pb-2 pt-1 text-[13px] font-semibold text-muted">{userEmail}</p>
          <Link
            href="/account"
            role="menuitem"
            onClick={close}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm font-semibold text-ink hover:bg-paper"
          >
            <Settings size={16} strokeWidth={2} aria-hidden="true" />
            Ustawienia konta
          </Link>
          <div className="my-1 border-t border-border" />
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
      )}
    </div>
  );
}
