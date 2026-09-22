import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { CourseCatalogItem } from '@/lib/courses-types';
import CourseCatalog from './CourseCatalog';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

const item = (overrides: Partial<CourseCatalogItem> = {}): CourseCatalogItem => ({
  courseId: 'course-1',
  title: 'Sprawa: wyłudzone hasło',
  subtitle: 'Prawdziwy przypadek phishingu',
  level: 'basic',
  objectives: [],
  category: 'PHISHING_SOCIAL_ENGINEERING',
  durationMinutes: 12,
  totalBlocks: 9,
  ...overrides,
});

describe('CourseCatalog', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    pushMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('nic nie renderuje, gdy katalog jest pusty', () => {
    const { container } = render(<CourseCatalog courses={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renderuje kartę kursu z tytułem, podtytułem i czasem trwania', () => {
    render(<CourseCatalog courses={[item()]} />);
    expect(screen.getByText('Sprawa: wyłudzone hasło')).toBeInTheDocument();
    expect(screen.getByText('Prawdziwy przypadek phishingu')).toBeInTheDocument();
    expect(screen.getByText('12 min')).toBeInTheDocument();
  });

  it('"Rozpocznij": POST na self-assign, potem nawigacja do odtwarzacza', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ assignmentId: 'a1' }) });
    render(<CourseCatalog courses={[item()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rozpocznij' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/courses/course-1/self-assign', { method: 'POST' });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/courses/course-1'));
  });

  it('błąd self-assign: pokazuje komunikat, NIE nawiguje, przycisk wraca do "Rozpocznij"', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: 'Błąd' }) });
    render(<CourseCatalog courses={[item()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rozpocznij' }));

    await waitFor(() => expect(screen.getByText(/nie udało się rozpocząć/i)).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Rozpocznij' })).not.toBeDisabled();
  });

  it('przycisk jest zablokowany w trakcie żądania ("Rozpoczynanie…")', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));
    render(<CourseCatalog courses={[item()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rozpocznij' }));

    expect(screen.getByRole('button', { name: 'Rozpoczynanie…' })).toBeDisabled();
    resolveFetch({ ok: true, json: async () => ({ assignmentId: 'a1' }) });
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
  });
});
