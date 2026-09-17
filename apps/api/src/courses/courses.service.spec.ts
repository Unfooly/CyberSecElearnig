import { Test, TestingModule } from '@nestjs/testing';
import { CoursesService } from './courses.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

describe('CoursesService.listMyCourses', () => {
  let service: CoursesService;
  let findMany: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn();
    const tenantPrisma = {
      runInOrgContext: jest.fn((_organizationId: string, fn: (tx: unknown) => unknown) =>
        fn({ courseAssignment: { findMany } }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CoursesService, { provide: TenantPrismaService, useValue: tenantPrisma }],
    }).compile();

    service = module.get(CoursesService);
  });

  it('liczy totalBlocks z course.contentBlocks.length i przekazuje currentBlockIndex assignmentu', async () => {
    findMany.mockResolvedValue([
      {
        id: 'assignment-1',
        status: 'IN_PROGRESS',
        score: null,
        dueDate: null,
        completedAt: null,
        currentBlockIndex: 2,
        course: {
          id: 'course-1',
          title: 'Rozpoznawanie phishingu',
          category: 'EMAIL_SECURITY',
          durationMinutes: 8,
          mandatory: true,
          contentBlocks: [{ type: 'VIDEO' }, { type: 'QUIZ' }, { type: 'QUIZ' }, { type: 'DRAG_AND_DROP' }],
        },
      },
    ]);

    const [result] = await service.listMyCourses('org-1', 'user-1');

    expect(result.currentBlockIndex).toBe(2);
    expect(result.totalBlocks).toBe(4);
  });

  it('zwraca totalBlocks=0 dla kursu z uszkodzoną treścią (contentBlocks nie jest tablicą), zamiast rzucać', async () => {
    findMany.mockResolvedValue([
      {
        id: 'assignment-2',
        status: 'NOT_STARTED',
        score: null,
        dueDate: null,
        completedAt: null,
        currentBlockIndex: 0,
        course: {
          id: 'course-2',
          title: 'Kurs z uszkodzoną treścią',
          category: 'GENERAL_AWARENESS',
          durationMinutes: 5,
          mandatory: false,
          contentBlocks: null,
        },
      },
    ]);

    const [result] = await service.listMyCourses('org-1', 'user-1');

    expect(result.totalBlocks).toBe(0);
  });

  it('zwraca totalBlocks=0 dla kursu z pustą tablicą contentBlocks', async () => {
    findMany.mockResolvedValue([
      {
        id: 'assignment-3',
        status: 'NOT_STARTED',
        score: null,
        dueDate: null,
        completedAt: null,
        currentBlockIndex: 0,
        course: {
          id: 'course-3',
          title: 'Kurs bez treści',
          category: 'GENERAL_AWARENESS',
          durationMinutes: 5,
          mandatory: false,
          contentBlocks: [],
        },
      },
    ]);

    const [result] = await service.listMyCourses('org-1', 'user-1');

    expect(result.totalBlocks).toBe(0);
  });
});
