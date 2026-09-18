import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Logo from './Logo';

describe('Logo', () => {
  it('ma dostępną nazwę "Unfooly" i domyślnie 26 px wysokości', () => {
    render(<Logo />);
    expect(screen.getByRole('img', { name: 'Unfooly' })).toHaveStyle({ height: '26px' });
  });

  it('kropka jest w kolorze akcentu w wariantach dark i white', () => {
    const { container, rerender } = render(<Logo variant="dark" />);
    expect(container.querySelector('circle[fill="#6C5CE7"]')).not.toBeNull();
    rerender(<Logo variant="white" />);
    expect(container.querySelector('circle[fill="#6C5CE7"]')).not.toBeNull();
  });

  it('wariant mono dziedziczy kolor przez currentColor (bez fioletu)', () => {
    const { container } = render(<Logo variant="mono" />);
    expect(container.querySelector('[fill="#6C5CE7"]')).toBeNull();
    expect(container.querySelector('circle[fill="currentColor"]')).not.toBeNull();
  });
});
