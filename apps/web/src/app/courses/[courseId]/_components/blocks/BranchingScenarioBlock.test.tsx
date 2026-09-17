import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BranchingScenarioBlock from './BranchingScenarioBlock';

const block = {
  type: 'BRANCHING_SCENARIO' as const,
  prompt: "Dostałeś maila od 'dostawcy' z pilną prośbą o płatność. Co robisz?",
  options: [
    { text: 'Klikam link i płacę od razu' },
    { text: 'Sprawdzam adres nadawcy i dzwonię do dostawcy' },
  ],
};

describe('BranchingScenarioBlock', () => {
  it('renderuje treść scenariusza i opcje', () => {
    render(<BranchingScenarioBlock block={block} onSubmit={vi.fn()} disabled={false} />);

    expect(screen.getByText(block.prompt)).toBeInTheDocument();
    expect(screen.getByText('Klikam link i płacę od razu')).toBeInTheDocument();
  });

  it('używa innego czasownika w interfejsie niż QuizBlock ("Co robisz?" zamiast "Wybierz odpowiedź")', () => {
    render(<BranchingScenarioBlock block={block} onSubmit={vi.fn()} disabled={false} />);

    expect(screen.getByRole('button', { name: 'Co robisz?' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Wybierz odpowiedź' })).not.toBeInTheDocument();
  });

  it('wywołuje onSubmit z indeksem wybranej decyzji', () => {
    const onSubmit = vi.fn();
    render(<BranchingScenarioBlock block={block} onSubmit={onSubmit} disabled={false} />);

    fireEvent.click(screen.getByText('Sprawdzam adres nadawcy i dzwonię do dostawcy'));
    fireEvent.click(screen.getByRole('button', { name: 'Co robisz?' }));

    expect(onSubmit).toHaveBeenCalledWith(1);
  });
});
