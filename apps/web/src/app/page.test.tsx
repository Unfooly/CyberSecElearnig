import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from './page';

describe('HomePage', () => {
  it('renderuje nazwę platformy', () => {
    render(<HomePage />);
    expect(screen.getByText('CyberSzkoło')).toBeInTheDocument();
  });
});
