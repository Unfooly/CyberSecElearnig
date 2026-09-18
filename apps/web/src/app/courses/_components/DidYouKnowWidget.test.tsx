import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DidYouKnowWidget from './DidYouKnowWidget';

describe('DidYouKnowWidget', () => {
  it('renderuje pierwszy fakt i licznik 1/N', () => {
    render(<DidYouKnowWidget />);

    expect(screen.getByText('Czy wiedziałeś/aś?')).toBeInTheDocument();
    expect(screen.getByText(/^1\/\d+$/)).toBeInTheDocument();
  });

  it('przycisk "Następny fakt" przechodzi do kolejnego faktu i zwiększa licznik', () => {
    render(<DidYouKnowWidget />);
    const firstFactText = screen.getByText(/atak/i).textContent;

    fireEvent.click(screen.getByRole('button', { name: 'Następny fakt' }));

    expect(screen.getByText('2/10')).toBeInTheDocument();
    expect(screen.queryByText(firstFactText as string)).not.toBeInTheDocument();
  });

  it('przycisk "Poprzedni fakt" na pierwszym fakcie zawija do ostatniego (bez wywalenia się)', () => {
    render(<DidYouKnowWidget />);

    fireEvent.click(screen.getByRole('button', { name: 'Poprzedni fakt' }));

    expect(screen.getByText('10/10')).toBeInTheDocument();
  });
});
