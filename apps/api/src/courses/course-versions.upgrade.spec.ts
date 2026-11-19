import { AssignmentStatus, Prisma } from '@prisma/client';
import { upgradeUnstartedPin } from './course-versions';

// D-177: przypisanie przed ukończeniem pierwszego bloku przechodzi przy /start na najnowszą wersję; dalej - zostaje na swojej.
describe('upgradeUnstartedPin (D-177)', () => {
  const base = {
    id: 'a1',
    organizationId: 'org-1',
    courseId: 'c1',
    courseVersionId: 'v1',
    status: AssignmentStatus.IN_PROGRESS,
    currentBlockIndex: 0,
    progress: { v: 2, blocks: {}, notes: [] },
    course: { id: 'c1' },
  } as never;

  function tx(latest: string | null, movedCount = 1) {
    return {
      courseVersion: { findFirst: jest.fn().mockResolvedValue(latest ? { id: latest } : null) },
      courseAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: movedCount }),
        findFirst: jest.fn().mockResolvedValue({ id: 'a1', courseVersionId: latest, progress: null }),
      },
    };
  }

  it('blok 0, starsza wersja przypięta: przepina na najnowszą warunkowo (ta sama wersja, blok 0, nieukończone), czyści postęp', async () => {
    const t = tx('v2');
    const result = (await upgradeUnstartedPin(t as never, base)) as { courseVersionId: string; course: unknown };
    expect(t.courseAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', organizationId: 'org-1', courseVersionId: 'v1', currentBlockIndex: 0, status: { not: AssignmentStatus.COMPLETED } },
      data: { courseVersionId: 'v2', progress: Prisma.DbNull },
    });
    expect(result.courseVersionId).toBe('v2');
    // Relacje z odczytu wywołującego (kurs, użytkownik) zostają.
    expect(result.course).toEqual({ id: 'c1' });
  });

  it('bez zmian: najnowsza już przypięta, kurs dalej niż blok 0, ukończony, nieprzypięty albo wyścig (count 0)', async () => {
    for (const [assignment, latest] of [
      [base, 'v1'],
      [{ ...(base as object), currentBlockIndex: 1 }, 'v2'],
      [{ ...(base as object), status: AssignmentStatus.COMPLETED }, 'v2'],
      [{ ...(base as object), courseVersionId: null }, 'v2'],
    ] as const) {
      const t = tx(latest);
      expect(await upgradeUnstartedPin(t as never, assignment as never)).toBe(assignment);
      expect(t.courseAssignment.updateMany).not.toHaveBeenCalled();
    }
    const raced = tx('v2', 0);
    expect(await upgradeUnstartedPin(raced as never, base)).toBe(base);
    expect(raced.courseAssignment.findFirst).not.toHaveBeenCalled();
  });
});
