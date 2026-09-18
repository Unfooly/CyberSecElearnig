import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AvatarDisplay from './AvatarDisplay';

describe('AvatarDisplay', () => {
  it('renderuje emoji presetu, gdy avatarUrl jest znanym slugiem', () => {
    render(<AvatarDisplay avatarUrl="fox" label="Mój avatar" />);

    expect(screen.getByRole('img', { name: 'Mój avatar' })).toHaveTextContent('🦊');
  });

  it('renderuje <img> z URL, gdy avatarUrl nie jest znanym presetem', () => {
    render(<AvatarDisplay avatarUrl="https://example.test/custom.png" label="Custom avatar" />);

    const img = screen.getByRole('img', { name: 'Custom avatar' });
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', 'https://example.test/custom.png');
  });

  it('renderuje domyślną ikonę, gdy avatarUrl jest null', () => {
    render(<AvatarDisplay avatarUrl={null} />);

    expect(screen.getByRole('img', { name: /brak avatara/i })).toHaveTextContent('👤');
  });
});
