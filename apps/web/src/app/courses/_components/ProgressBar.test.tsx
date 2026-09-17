import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProgressBar from './ProgressBar';

describe('ProgressBar', () => {
  it('nie renderuje niczego, gdy totalBlocks=0 (nie da się wyliczyć procentu)', () => {
    const { container } = render(<ProgressBar currentBlockIndex={0} totalBlocks={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('wylicza procent z currentBlockIndex/totalBlocks i pokazuje liczbę bloków', () => {
    render(<ProgressBar currentBlockIndex={2} totalBlocks={4} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('2 / 4 bloków')).toBeInTheDocument();
  });

  it('nie przekracza 100%, gdy currentBlockIndex >= totalBlocks', () => {
    render(<ProgressBar currentBlockIndex={5} totalBlocks={4} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
});
