import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from './StatusBadge';
import type { AssignmentStatus } from '@/lib/courses-types';

const CASES: Array<[AssignmentStatus, string]> = [
  ['NOT_STARTED', 'Nierozpoczęty'],
  ['IN_PROGRESS', 'W toku'],
  ['COMPLETED', 'Ukończony'],
  ['OVERDUE', 'Zaległy'],
];

describe('StatusBadge', () => {
  it.each(CASES)('renderuje poprawną etykietę dla statusu %s', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
