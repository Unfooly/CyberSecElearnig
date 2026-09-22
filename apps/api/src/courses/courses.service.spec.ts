import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CoursesService } from './courses.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { GamificationService } from '../gamification/gamification.service';

const configProvider = { provide: ConfigService, useValue: { getOrThrow: () => 'test-secret' } };

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
      providers: [
        CoursesService,
        { provide: TenantPrismaService, useValue: tenantPrisma },
        { provide: GamificationService, useValue: { awardCourseCompletion: jest.fn() } },
        configProvider,
      ],
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
        mandatory: true,
        course: {
          id: 'course-1',
          title: 'Rozpoznawanie phishingu',
          category: 'EMAIL_SECURITY',
          durationMinutes: 8,
          contentBlocks: [{ type: 'VIDEO' }, { type: 'QUIZ' }, { type: 'QUIZ' }, { type: 'DRAG_AND_DROP' }],
        },
      },
    ]);

    const [result] = await service.listMyCourses('org-1', 'user-1');

    expect(result.currentBlockIndex).toBe(2);
    expect(result.totalBlocks).toBe(4);
  });

  it('mandatory pochodzi z PRZYPISANIA (D-065), nie z course.mandatory - samoobsługowy kurs zostaje nieobowiązkowy nawet gdy treść jest mandatory:true', async () => {
    findMany.mockResolvedValue([
      {
        id: 'assignment-self',
        status: 'NOT_STARTED',
        score: null,
        dueDate: null,
        completedAt: null,
        currentBlockIndex: 0,
        mandatory: false,
        course: {
          id: 'course-1',
          title: 'Sprawa: wyłudzone hasło',
          category: 'PHISHING_SOCIAL_ENGINEERING',
          durationMinutes: 12,
          contentBlocks: [{ type: 'NARRATIVE' }],
        },
      },
    ]);

    const [result] = await service.listMyCourses('org-1', 'user-1');

    expect(result.mandatory).toBe(false);
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
          contentBlocks: null,
        },
      },
    ]);

    const [result] = await service.listMyCourses('org-1', 'user-1');

    expect(result.totalBlocks).toBe(0);
  });

  it('czyta tylko AKTYWNE przypisania (D-069: archivedAt: null) - historia po restarcie nie wraca jako "moje kursy"', async () => {
    findMany.mockResolvedValue([]);

    await service.listMyCourses('org-1', 'user-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1', userId: 'user-1', archivedAt: null } }),
    );
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
          contentBlocks: [],
        },
      },
    ]);

    const [result] = await service.listMyCourses('org-1', 'user-1');

    expect(result.totalBlocks).toBe(0);
  });
});

describe('CoursesService.listCatalog / selfAssign (D-065)', () => {
  let service: CoursesService;
  let courseAssignmentFindMany: jest.Mock;
  let courseFindMany: jest.Mock;
  let courseFindUnique: jest.Mock;
  let createMany: jest.Mock;
  let assignmentFindFirst: jest.Mock;

  beforeEach(async () => {
    courseAssignmentFindMany = jest.fn();
    courseFindMany = jest.fn();
    courseFindUnique = jest.fn();
    createMany = jest.fn().mockResolvedValue({ count: 1 });
    assignmentFindFirst = jest.fn();

    const tenantPrisma = {
      runInOrgContext: jest.fn((_organizationId: string, fn: (tx: unknown) => unknown) =>
        fn({
          courseAssignment: { findMany: courseAssignmentFindMany, createMany, findFirst: assignmentFindFirst },
          course: { findMany: courseFindMany, findUnique: courseFindUnique },
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoursesService,
        { provide: TenantPrismaService, useValue: tenantPrisma },
        { provide: GamificationService, useValue: { awardCourseCompletion: jest.fn() } },
        configProvider,
      ],
    }).compile();

    service = module.get(CoursesService);
  });

  it('listCatalog pomija kursy, na które wywołujący ma już przypisanie', async () => {
    courseAssignmentFindMany.mockResolvedValue([{ courseId: 'course-już-przypisany' }]);
    courseFindMany.mockResolvedValue([
      {
        id: 'course-nowy',
        title: 'Sprawa: wyłudzone hasło',
        subtitle: 'Prawdziwy przypadek phishingu',
        level: 'basic',
        objectives: ['Rozpoznaj fałszywy mail'],
        category: 'PHISHING_SOCIAL_ENGINEERING',
        durationMinutes: 12,
        contentBlocks: [{ type: 'NARRATIVE' }],
        versions: [{ blockCount: 9 }],
      },
    ]);

    const [result] = await service.listCatalog('org-1', 'user-1');

    expect(courseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { notIn: ['course-już-przypisany'] } } }),
    );
    expect(result).toEqual({
      courseId: 'course-nowy',
      title: 'Sprawa: wyłudzone hasło',
      subtitle: 'Prawdziwy przypadek phishingu',
      level: 'basic',
      objectives: ['Rozpoznaj fałszywy mail'],
      category: 'PHISHING_SOCIAL_ENGINEERING',
      durationMinutes: 12,
      totalBlocks: 9,
    });
  });

  it('listCatalog: bez przypisań wywołującego, zapytanie idzie bez filtra notIn (pusta lista courseId byłaby błędem Prisma)', async () => {
    courseAssignmentFindMany.mockResolvedValue([]);
    courseFindMany.mockResolvedValue([]);

    await service.listCatalog('org-1', 'user-1');

    expect(courseFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
  });

  it('listCatalog: przypisania "już mam ten kurs" czyta tylko AKTYWNE (D-069)', async () => {
    courseAssignmentFindMany.mockResolvedValue([]);
    courseFindMany.mockResolvedValue([]);

    await service.listCatalog('org-1', 'user-1');

    expect(courseAssignmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1', userId: 'user-1', archivedAt: null } }),
    );
  });

  it('selfAssign tworzy przypisanie ZAWSZE z mandatory:false, niezależnie od treści kursu', async () => {
    courseFindUnique.mockResolvedValue({ id: 'course-1' });
    assignmentFindFirst.mockResolvedValue({ id: 'assignment-nowy' });

    const result = await service.selfAssign('org-1', 'user-1', 'course-1');

    expect(createMany).toHaveBeenCalledWith({
      data: [{ organizationId: 'org-1', userId: 'user-1', courseId: 'course-1', mandatory: false }],
      skipDuplicates: true,
    });
    expect(assignmentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1', userId: 'user-1', courseId: 'course-1', archivedAt: null } }),
    );
    expect(result).toEqual({ assignmentId: 'assignment-nowy' });
  });

  it('selfAssign jest idempotentny: drugie wywołanie (skipDuplicates trafia w istniejący wiersz) nadal zwraca to samo assignmentId', async () => {
    courseFindUnique.mockResolvedValue({ id: 'course-1' });
    createMany.mockResolvedValue({ count: 0 }); // skipDuplicates: wiersz już istniał
    assignmentFindFirst.mockResolvedValue({ id: 'assignment-istniejący' });

    const result = await service.selfAssign('org-1', 'user-1', 'course-1');

    expect(result).toEqual({ assignmentId: 'assignment-istniejący' });
  });

  it('selfAssign na nieistniejącym kursie rzuca NotFoundException, zamiast tworzyć przypisanie', async () => {
    courseFindUnique.mockResolvedValue(null);

    await expect(service.selfAssign('org-1', 'user-1', 'nie-ma-takiego')).rejects.toBeInstanceOf(NotFoundException);
    expect(createMany).not.toHaveBeenCalled();
  });
});

describe('CoursesService.restart ("Rozpocznij od nowa", D-069)', () => {
  let service: CoursesService;
  let assignmentFindFirst: jest.Mock;
  let assignmentUpdateMany: jest.Mock;
  let assignmentCreate: jest.Mock;
  let courseVersionFindFirst: jest.Mock;
  let queryRaw: jest.Mock;

  function assignmentFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: 'assignment-old',
      status: 'COMPLETED',
      mandatory: true,
      dueDate: new Date('2026-01-01T00:00:00.000Z'),
      course: { id: 'course-1' },
      ...overrides,
    };
  }

  beforeEach(async () => {
    assignmentFindFirst = jest.fn();
    assignmentUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    assignmentCreate = jest.fn().mockResolvedValue({ id: 'assignment-new' });
    courseVersionFindFirst = jest.fn().mockResolvedValue({ id: 'version-2' });
    queryRaw = jest.fn();

    const tenantPrisma = {
      runInOrgContext: jest.fn((_organizationId: string, fn: (tx: unknown) => unknown) =>
        fn({
          courseAssignment: { findFirst: assignmentFindFirst, updateMany: assignmentUpdateMany, create: assignmentCreate },
          courseVersion: { findFirst: courseVersionFindFirst },
          $queryRaw: queryRaw,
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoursesService,
        { provide: TenantPrismaService, useValue: tenantPrisma },
        { provide: GamificationService, useValue: { awardCourseCompletion: jest.fn() } },
        configProvider,
      ],
    }).compile();

    service = module.get(CoursesService);
  });

  it('archiwizuje stare przypisanie i tworzy nowe z mandatory/dueDate przepisanymi i przypiętą NAJNOWSZĄ wersją', async () => {
    assignmentFindFirst.mockResolvedValue(assignmentFixture());

    const result = await service.restart('org-1', 'user-1', 'course-1');

    expect(assignmentUpdateMany).toHaveBeenCalledWith({
      where: { id: 'assignment-old', organizationId: 'org-1', archivedAt: null },
      data: { archivedAt: expect.any(Date) },
    });
    expect(courseVersionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { courseId: 'course-1' }, orderBy: { version: 'desc' } }),
    );
    expect(assignmentCreate).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        userId: 'user-1',
        courseId: 'course-1',
        mandatory: true,
        dueDate: new Date('2026-01-01T00:00:00.000Z'),
        courseVersionId: 'version-2',
      },
      select: { id: true },
    });
    expect(result).toEqual({ assignmentId: 'assignment-new' });
  });

  it('NIE woła GamificationService - XP/odznaki/ranking nietknięte samym restartem', async () => {
    assignmentFindFirst.mockResolvedValue(assignmentFixture());
    const gamification = { awardCourseCompletion: jest.fn() };
    const tenantPrisma = {
      runInOrgContext: jest.fn((_organizationId: string, fn: (tx: unknown) => unknown) =>
        fn({
          courseAssignment: { findFirst: assignmentFindFirst, updateMany: assignmentUpdateMany, create: assignmentCreate },
          courseVersion: { findFirst: courseVersionFindFirst },
          $queryRaw: queryRaw,
        }),
      ),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoursesService,
        { provide: TenantPrismaService, useValue: tenantPrisma },
        { provide: GamificationService, useValue: gamification },
        configProvider,
      ],
    }).compile();
    const isolatedService = module.get(CoursesService);

    await isolatedService.restart('org-1', 'user-1', 'course-1');

    expect(gamification.awardCourseCompletion).not.toHaveBeenCalled();
  });

  it('kurs NIEUKOŃCZONY (IN_PROGRESS/NOT_STARTED): 409, żadnej archiwizacji ani nowego przypisania', async () => {
    assignmentFindFirst.mockResolvedValue(assignmentFixture({ status: 'IN_PROGRESS' }));

    await expect(service.restart('org-1', 'user-1', 'course-1')).rejects.toBeInstanceOf(ConflictException);
    expect(assignmentUpdateMany).not.toHaveBeenCalled();
    expect(assignmentCreate).not.toHaveBeenCalled();
  });

  it('drugi restart zaraz po pierwszym (idempotencja): przypisanie już zarchiwizowane (updateMany trafia 0 wierszy) => 409', async () => {
    assignmentFindFirst.mockResolvedValue(assignmentFixture());
    assignmentUpdateMany.mockResolvedValue({ count: 0 });

    await expect(service.restart('org-1', 'user-1', 'course-1')).rejects.toBeInstanceOf(ConflictException);
    expect(assignmentCreate).not.toHaveBeenCalled();
  });

  it('brak własnego przypisania tego kursu => NotFoundException (nie 409)', async () => {
    assignmentFindFirst.mockResolvedValue(null);

    await expect(service.restart('org-1', 'user-1', 'course-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findOwnAssignment/lockOwnAssignment czytają/blokują tylko przypisanie AKTYWNE (archivedAt: null w where / raw SQL)', async () => {
    assignmentFindFirst.mockResolvedValue(assignmentFixture());

    await service.restart('org-1', 'user-1', 'course-1');

    expect(assignmentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1', userId: 'user-1', courseId: 'course-1', archivedAt: null } }),
    );
    expect(queryRaw).toHaveBeenCalled();
    const [sqlParts] = queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(sqlParts.join('')).toContain('archivedAt');
  });
});

describe('CoursesService.submitBlockProgress / attemptBlock — hak grywalizacji, ochrona przed wyścigiem, reaction', () => {
  let service: CoursesService;
  let findFirst: jest.Mock;
  let updateMany: jest.Mock;
  let update: jest.Mock;
  let awardCourseCompletion: jest.Mock;

  function assignmentFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: 'assignment-1',
      status: 'IN_PROGRESS',
      currentBlockIndex: 0,
      progress: null,
      course: {
        id: 'course-1',
        contentBlocks: [{ type: 'VIDEO' }],
      },
      ...overrides,
    };
  }

  beforeEach(async () => {
    findFirst = jest.fn();
    // Domyślnie "udany claim" (1 zaktualizowany wiersz) - test wyścigu
    // nadpisuje to na {count: 0} dla konkretnego wywołania.
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    // Tylko attemptBlock (TEXT_INPUT_GUIDED) woła `update` (nie `updateMany`) na przypisaniu.
    update = jest.fn().mockResolvedValue({});
    awardCourseCompletion = jest
      .fn()
      .mockResolvedValue({ xpGained: 100, newLevel: 1, leveledUp: false, unlockedBadges: [] });

    // Kurs z treścią sprzed silnika nie ma jeszcze wersji: resolveVersion tworzy "wersję 1" z course.contentBlocks. Mock
    // odtwarza to, zwracając wersję zbudowaną z treści aktualnej fixtury.
    const courseVersion = {
      findFirst: jest.fn(async () => {
        const assignment = (await findFirst()) as { course: { id: string; contentBlocks: unknown } };
        return {
          id: 'version-1',
          courseId: assignment.course.id,
          version: 1,
          schemaVersion: 1,
          contentBlocks: assignment.course.contentBlocks,
        };
      }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn(),
    };

    const tenantPrisma = {
      runInOrgContext: jest.fn((_organizationId: string, fn: (tx: unknown) => unknown) =>
        fn({ courseAssignment: { findFirst, updateMany, update }, courseVersion, $queryRaw: jest.fn() }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoursesService,
        { provide: TenantPrismaService, useValue: tenantPrisma },
        { provide: GamificationService, useValue: { awardCourseCompletion } },
        configProvider,
      ],
    }).compile();

    service = module.get(CoursesService);
  });

  it('woła GamificationService.awardCourseCompletion, gdy ostatni blok kończy kurs (isComplete)', async () => {
    findFirst.mockResolvedValue(assignmentFixture());

    await service.submitBlockProgress('org-1', 'user-1', 'course-1', { blockIndex: 0 });

    expect(awardCourseCompletion).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'user-1',
      { score: null },
    );
  });

  it('NIE woła GamificationService.awardCourseCompletion, gdy kurs ma jeszcze kolejne bloki', async () => {
    findFirst.mockResolvedValue(
      assignmentFixture({ course: { id: 'course-1', contentBlocks: [{ type: 'VIDEO' }, { type: 'VIDEO' }] } }),
    );

    await service.submitBlockProgress('org-1', 'user-1', 'course-1', { blockIndex: 0 });

    expect(awardCourseCompletion).not.toHaveBeenCalled();
  });

  it('przekazuje faktyczny wynik (score) do awardCourseCompletion, żeby PERFECT_SCORE mógł zadziałać', async () => {
    findFirst.mockResolvedValue(
      assignmentFixture({ course: { id: 'course-1', contentBlocks: [{ type: 'QUIZ', options: [{ correct: true }] }] } }),
    );

    await service.submitBlockProgress('org-1', 'user-1', 'course-1', { blockIndex: 0, answer: 0 });

    expect(awardCourseCompletion).toHaveBeenCalledWith(expect.anything(), 'org-1', 'user-1', { score: 100 });
  });

  it('dołącza wynik GamificationService do odpowiedzi jako pole `gamification`, gdy kurs się kończy', async () => {
    findFirst.mockResolvedValue(assignmentFixture());
    awardCourseCompletion.mockResolvedValue({
      xpGained: 150,
      newLevel: 2,
      leveledUp: true,
      unlockedBadges: [{ code: 'FIRST_STEP', title: 'Pierwszy Krok', icon: 'first-step', xpReward: 50 }],
    });

    const result = await service.submitBlockProgress('org-1', 'user-1', 'course-1', { blockIndex: 0 });

    expect(result.gamification).toEqual({
      xpGained: 150,
      newLevel: 2,
      leveledUp: true,
      unlockedBadges: [{ code: 'FIRST_STEP', title: 'Pierwszy Krok', icon: 'first-step', xpReward: 50 }],
    });
  });

  it('zwraca `gamification: null`, gdy kurs się jeszcze nie kończy', async () => {
    findFirst.mockResolvedValue(
      assignmentFixture({ course: { id: 'course-1', contentBlocks: [{ type: 'VIDEO' }, { type: 'VIDEO' }] } }),
    );

    const result = await service.submitBlockProgress('org-1', 'user-1', 'course-1', { blockIndex: 0 });

    expect(result.gamification).toBeNull();
  });

  it('woła updateMany z WHERE zawierającym currentBlockIndex odczytany na starcie (optymistyczna blokada)', async () => {
    findFirst.mockResolvedValue(assignmentFixture({ currentBlockIndex: 2, course: { id: 'course-1', contentBlocks: [{ type: 'VIDEO' }, { type: 'VIDEO' }, { type: 'VIDEO' }] } }));

    await service.submitBlockProgress('org-1', 'user-1', 'course-1', { blockIndex: 2 });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'assignment-1', currentBlockIndex: 2 } }),
    );
  });

  it('wyścig: gdy updateMany trafia 0 wierszy (równoległe żądanie już zapisało ten sam blok), rzuca ConflictException i NIE przyznaje XP', async () => {
    findFirst.mockResolvedValue(assignmentFixture());
    updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.submitBlockProgress('org-1', 'user-1', 'course-1', { blockIndex: 0 }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(awardCourseCompletion).not.toHaveBeenCalled();
  });

  it('/start na ukończonym kursie nie zmienia statusu (żadnego updateMany po status)', async () => {
    findFirst.mockResolvedValue(assignmentFixture({ status: 'COMPLETED', currentBlockIndex: 1 }));

    const result = await service.startOrContinue('org-1', 'user-1', 'course-1');

    expect(result.status).toBe('COMPLETED');
    for (const [args] of updateMany.mock.calls) expect(args.where).not.toHaveProperty('status');
  });

  it('wyścig /start: równoległy zapis ukończył kurs po odczycie NOT_STARTED - status zostaje COMPLETED, nie wraca na IN_PROGRESS', async () => {
    // Kolejność odczytów: przypisanie, wersja (mock wersji czyta fixturę), ponowny odczyt po warunkowym updateMany.
    findFirst
      .mockResolvedValueOnce(assignmentFixture({ status: 'NOT_STARTED' }))
      .mockResolvedValueOnce(assignmentFixture({ status: 'NOT_STARTED' }))
      .mockResolvedValueOnce(assignmentFixture({ status: 'COMPLETED', currentBlockIndex: 1 }));
    // Przypięcie wersji (count 1), potem warunkowe NOT_STARTED -> IN_PROGRESS trafia w 0 wierszy (kurs już COMPLETED).
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const result = await service.startOrContinue('org-1', 'user-1', 'course-1');

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'assignment-1', status: 'NOT_STARTED' }) }),
    );
    expect(result.status).toBe('COMPLETED');
    expect(result.currentBlockIndex).toBe(1);
  });

  it('lastResult niesie reaction (schemaVersion 4) dopiero po ocenie, dobraną wg wyniku', async () => {
    findFirst.mockResolvedValue(
      assignmentFixture({
        course: {
          id: 'course-1',
          contentBlocks: [
            {
              type: 'QUIZ',
              options: [{ correct: true }, { correct: false }],
              reactions: { result: [{ minScore: 1, pose: 'cheer', text: 'Świetnie!' }, { minScore: 0, pose: 'warning', text: 'Spróbuj ponownie.' }] },
            },
          ],
        },
      }),
    );

    const correct = await service.submitBlockProgress('org-1', 'user-1', 'course-1', { blockIndex: 0, answer: 0 });
    expect(correct.lastResult.reaction).toEqual({ pose: 'cheer', text: 'Świetnie!' });
  });

  it('EMBEDDED_HTML jest traktowany jak blok niescorowany - kończy się bez wymaganej odpowiedzi', async () => {
    findFirst.mockResolvedValue(
      assignmentFixture({ course: { id: 'course-1', contentBlocks: [{ type: 'EMBEDDED_HTML', html: '<html></html>' }] } }),
    );

    const result = await service.submitBlockProgress('org-1', 'user-1', 'course-1', { blockIndex: 0 });

    expect(result.lastResult).toEqual({ blockIndex: 0, blockId: 'b0', type: 'EMBEDDED_HTML', correct: undefined });
    expect(result.status).toBe('COMPLETED');
    expect(awardCourseCompletion).toHaveBeenCalledWith(expect.anything(), 'org-1', 'user-1', { score: null });
  });

  describe('attemptBlock (TEXT_INPUT_GUIDED): reaction (schemaVersion 4) tylko przy rozstrzygnięciu', () => {
    // Treść "sprzed silnika" w tej fixturze zawsze dostaje id legacy (b0, b1...) - patrz test EMBEDDED_HTML wyżej (blockId: 'b0').
    const textBlock = {
      type: 'TEXT_INPUT_GUIDED',
      answer: { accept: ['bank.pl'] },
      maxAttempts: 3,
      reactions: { result: [{ when: 'correct', pose: 'cheer', text: 'Brawo!' }, { when: 'incorrect', pose: 'warning', text: 'Spróbuj ponownie.' }] },
    };

    it('brak reaction przy próbie z pozostałymi podejściami; reaction dobrana wg poprawności dopiero po rozstrzygnięciu', async () => {
      findFirst.mockResolvedValue(assignmentFixture({ course: { id: 'course-1', contentBlocks: [textBlock] } }));

      const wrong = await service.attemptBlock('org-1', 'user-1', 'course-1', 'b0', 'zla-domena');
      expect(wrong).toMatchObject({ correct: false, done: false });
      expect(wrong).not.toHaveProperty('reaction');

      const right = await service.attemptBlock('org-1', 'user-1', 'course-1', 'b0', 'bank.pl');
      expect(right).toMatchObject({ correct: true, done: true });
      expect(right.reaction).toEqual({ pose: 'cheer', text: 'Brawo!' });
    });

    it('wyczerpanie prób: reaction "incorrect", bez wycieku when/minScore', async () => {
      findFirst.mockResolvedValue(assignmentFixture({ course: { id: 'course-1', contentBlocks: [{ ...textBlock, maxAttempts: 1 }] } }));

      const exhausted = await service.attemptBlock('org-1', 'user-1', 'course-1', 'b0', 'zla-domena');
      expect(exhausted).toMatchObject({ correct: false, done: true });
      expect(exhausted.reaction).toEqual({ pose: 'warning', text: 'Spróbuj ponownie.' });
    });
  });
});
