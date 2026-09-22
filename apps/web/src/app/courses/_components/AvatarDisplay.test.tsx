import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AvatarDisplay from './AvatarDisplay';

describe('AvatarDisplay', () => {
  it('renderuje ikonę presetu (SVG, nie emoji), gdy avatarUrl jest znanym slugiem', () => {
    render(<AvatarDisplay avatarUrl="fox" label="Mój avatar" />);

    const avatar = screen.getByRole('img', { name: 'Mój avatar' });
    expect(avatar.querySelector('svg')).not.toBeNull();
    expect(avatar).toHaveTextContent('');
  });

  it('wgrane zdjęcie (upload:<hash>) renderuje <img> z NASZEGO origin, ze skrótem w adresie', () => {
    render(<AvatarDisplay avatarUrl="upload:abc123" label="Mój avatar" userId="user-7" />);

    const img = screen.getByRole('img', { name: 'Mój avatar' });
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', '/api/users/user-7/avatar/image?v=abc123');
    // Adres strony (z tokenami w query na /reset-password itp.) nie może wyciec w nagłówku Referer.
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('bez userId wgrane zdjęcie pobieramy jako własne ("me" rozwiązuje trasa BFF z tokena)', () => {
    render(<AvatarDisplay avatarUrl="upload:abc123" label="Mój avatar" />);

    expect(screen.getByRole('img', { name: 'Mój avatar' })).toHaveAttribute('src', '/api/users/me/avatar/image?v=abc123');
  });

  // B-075/D-067: zewnętrzne adresy nie są już obsługiwane (CSP i tak ich nie wyświetli) - stare
  // dane migracja wyczyściła, a gdyby coś takiego przyszło, pokazujemy inicjały jak przy braku avatara.
  it('adres z obcej domeny NIE jest renderowany jako obrazek - zostają inicjały', () => {
    render(<AvatarDisplay avatarUrl="https://example.test/custom.png" initials="AK" />);

    const avatar = screen.getByRole('img', { name: /brak avatara/i });
    expect(avatar.tagName).not.toBe('IMG');
    expect(avatar).toHaveTextContent('AK');
  });

  it('renderuje domyślną ikonę, gdy avatarUrl jest null', () => {
    render(<AvatarDisplay avatarUrl={null} />);

    expect(screen.getByRole('img', { name: /brak avatara/i }).querySelector('svg')).not.toBeNull();
  });

  it('pokazuje inicjały zamiast ikony, gdy podano initials i brak avatara', () => {
    render(<AvatarDisplay avatarUrl={null} initials="AK" />);

    expect(screen.getByRole('img', { name: /brak avatara/i })).toHaveTextContent('AK');
  });
});
