import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BlockBackground from './BlockBackground';

// Tło bloku (B-138): dekoracja pod treścią - wariant pionowy na telefonie w pionie, `#static` przy reduced motion, niewidoczne dla czytnika.

function mockContainer(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON: () => ({}) } as DOMRect);
}

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('BlockBackground (B-138)', () => {
  it('bez tła - nic nie renderuje', () => {
    const { container } = render(<BlockBackground contentBase="/assets" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('poziomo: grafika pozioma, dekoracja (alt="", aria-hidden, bez zdarzeń wskaźnika), pod treścią', () => {
    mockReducedMotion(false);
    mockContainer(1200, 700);
    render(<BlockBackground contentBase="/assets" image="scenes/nagranie-tlo.svg" imagePortrait="scenes/nagranie-tlo-pion.svg" />);
    const frame = screen.getByTestId('block-background');
    expect(frame).toHaveAttribute('aria-hidden', 'true');
    expect(frame).toHaveClass('pointer-events-none', 'absolute', 'inset-0', '-z-10');
    const img = frame.querySelector('img')!;
    expect(img).toHaveAttribute('src', '/assets/scenes/nagranie-tlo.svg');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('data-variant', 'landscape');
  });

  it('telefon w pionie: wariant pionowy; bez wariantu pionowego - grafika pozioma', () => {
    mockReducedMotion(false);
    mockContainer(390, 700);
    const { unmount } = render(<BlockBackground contentBase="/assets" image="scenes/nagranie-tlo.svg" imagePortrait="scenes/nagranie-tlo-pion.svg" />);
    expect(screen.getByTestId('block-background').querySelector('img')).toHaveAttribute('src', '/assets/scenes/nagranie-tlo-pion.svg');
    unmount();
    render(<BlockBackground contentBase="/assets" image="scenes/nagranie-tlo.svg" />);
    expect(screen.getByTestId('block-background').querySelector('img')).toHaveAttribute('src', '/assets/scenes/nagranie-tlo.svg');
  });

  it('reduced motion: SVG z #static (animacje zatrzymane); ścieżka spoza bazy - bez obrazu', () => {
    mockReducedMotion(true);
    mockContainer(1200, 700);
    const { unmount } = render(<BlockBackground contentBase="/assets" image="scenes/nagranie-tlo.svg" />);
    expect(screen.getByTestId('block-background').querySelector('img')).toHaveAttribute('src', '/assets/scenes/nagranie-tlo.svg#static');
    unmount();
    render(<BlockBackground contentBase="/assets" image="../../etc/passwd.svg" />);
    expect(screen.getByTestId('block-background').querySelector('img')).toBeNull();
  });
});
