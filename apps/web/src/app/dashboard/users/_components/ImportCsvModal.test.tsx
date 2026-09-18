import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImportCsvModal from './ImportCsvModal';

function buildCsvFile(content: string, name = 'import.csv'): File {
  return new File([content], name, { type: 'text/csv' });
}

describe('ImportCsvModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pokazuje podgląd poprawnych/niepoprawnych wierszy po wybraniu pliku, przed wysyłką', async () => {
    render(<ImportCsvModal onClose={vi.fn()} onImported={vi.fn()} />);

    const file = buildCsvFile(
      'email,firstName,lastName,departmentName\njan@test.pl,Jan,Kowalski,IT\nzly-email,Anna,Nowak,\n',
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/1 poprawnych wierszy, 1 z błędami/)).toBeInTheDocument();
    expect(screen.getByText(/Nieprawidłowy format e-maila/)).toBeInTheDocument();
  });

  it('pokazuje błąd pliku i blokuje import dla strukturalnie uszkodzonego CSV', async () => {
    render(<ImportCsvModal onClose={vi.fn()} onImported={vi.fn()} />);

    const file = buildCsvFile('email,firstName,lastName\n"jan@test.pl,Jan,Kowalski\n');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/cudzysł/i);
  });

  it('wysyła plik do /api/users/import-csv i pokazuje raport po sukcesie', async () => {
    const report = { successCount: 1, failedCount: 0, errors: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => report });
    vi.stubGlobal('fetch', fetchMock);
    const onImported = vi.fn();

    render(<ImportCsvModal onClose={vi.fn()} onImported={onImported} />);

    const file = buildCsvFile('email,firstName,lastName,departmentName\njan@test.pl,Jan,Kowalski,IT\n');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    // Podgląd liczy się asynchronicznie (FileReader) - czekamy, aż się
    // pojawi, inaczej przycisk "Importuj" jest jeszcze disabled (canImport
    // zależy od preview) i kliknięcie nic by nie zrobiło.
    await screen.findByText(/poprawnych wierszy/);
    fireEvent.click(screen.getByRole('button', { name: 'Importuj' }));

    await waitFor(() => expect(screen.getByText(/Zaproszono 1 osobę/)).toBeInTheDocument());
    expect(onImported).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/users/import-csv',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    );
  });

  it('Escape zamyka modal', () => {
    const onClose = vi.fn();
    render(<ImportCsvModal onClose={onClose} onImported={vi.fn()} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });
});
