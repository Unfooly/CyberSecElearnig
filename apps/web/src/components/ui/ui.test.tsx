import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import Button, { ButtonLink } from './Button';
import Pill from './Pill';
import ProgressBar from './ProgressBar';
import EmptyState from './EmptyState';
import InitialsAvatar, { initialsFrom } from './InitialsAvatar';
import Card, { CardHeader } from './Card';

describe('Button', () => {
  it('primary domyślnie, type=button i reaguje na klik', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Zapisz</Button>);
    const button = screen.getByRole('button', { name: 'Zapisz' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('bg-accent', 'h-10');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
  });

  it('wariant secondary i rozmiar sm (32 px)', () => {
    render(
      <Button variant="secondary" size="sm">
        Anuluj
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Anuluj' })).toHaveClass('bg-surface', 'h-8');
  });

  it('disabled blokuje klik', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        X
      </Button>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ButtonLink do /api/ to zwykły <a> z atrybutem download', () => {
    render(
      <ButtonLink href="/api/dashboard/export" variant="secondary" download>
        Eksportuj
      </ButtonLink>,
    );
    expect(screen.getByRole('link', { name: 'Eksportuj' })).toHaveAttribute('download');
  });
});

describe('Pill', () => {
  it('renderuje tekst i kropkę tylko na życzenie', () => {
    const { container, rerender } = render(<Pill tone="ok">Aktywny</Pill>);
    expect(screen.getByText('Aktywny')).toHaveClass('bg-success-soft');
    expect(container.querySelector('[data-pill-dot]')).toBeNull();
    rerender(
      <Pill tone="warn" dot>
        Zaproszony
      </Pill>,
    );
    expect(container.querySelector('[data-pill-dot]')).not.toBeNull();
  });
});

describe('ProgressBar', () => {
  it('ustawia aria-valuenow i ogranicza wartość do 0-100', () => {
    const { rerender } = render(<ProgressBar value={78} label="Ukończenie" />);
    expect(screen.getByRole('progressbar', { name: 'Ukończenie' })).toHaveAttribute('aria-valuenow', '78');
    rerender(<ProgressBar value={140} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    rerender(<ProgressBar value={-5} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
});

describe('EmptyState', () => {
  it('pokazuje nagłówek, zdanie i akcję', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="Brak zespołu"
        description="Zaproś pierwszą osobę."
        action={<Button>Zaproś</Button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Brak zespołu' })).toBeInTheDocument();
    expect(screen.getByText('Zaproś pierwszą osobę.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zaproś' })).toBeInTheDocument();
  });
});

describe('InitialsAvatar', () => {
  it('inicjały z imienia i nazwiska, a bez nich z e-maila', () => {
    expect(initialsFrom('Anna', 'Kowalska', 'x@y.pl')).toBe('AK');
    expect(initialsFrom(null, null, 'adrian.pozniak@firma.pl')).toBe('AP');
    expect(initialsFrom(null, null, 'jan@firma.pl')).toBe('J');
  });

  it('renderuje inicjały', () => {
    render(<InitialsAvatar initials="AK" />);
    expect(screen.getByText('AK')).toBeInTheDocument();
  });
});

describe('Card', () => {
  it('CardHeader pokazuje tytuł i akcję', () => {
    render(
      <Card>
        <CardHeader title="Działy" action={<a href="#a">Zobacz</a>} />
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Działy' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zobacz' })).toBeInTheDocument();
  });
});
