import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { registerVerified } from './helpers/auth';

describe('Kursy e-learningowe (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const uniqueSuffix = Date.now();
  // Osobne domeny dla A/B - organizations.name jest teraz unikalne (nazwa =
  // domena), więc dwie organizacje w jednym pliku testowym potrzebują dwóch
  // różnych domen, nie tylko różnych lokalnych części e-maila.
  const orgAEmail = `courses-a-${uniqueSuffix}@org-a.courses-e2e-test.local`;
  const orgBEmail = `courses-b-${uniqueSuffix}@org-b.courses-e2e-test.local`;

  let orgAId: string;
  let orgAToken: string;
  let orgBToken: string;
  let courseId: string;
  let sequenceCourseId: string;

  // Cztery bloki, po jednym na typ z docs/content-backlog-elearning.md.
  // QUIZ używa "correct: boolean", BRANCHING_SCENARIO — "outcome" jak w
  // przykładzie z dokumentu. VIDEO/DRAG_AND_DROP nie są oceniane.
  const contentBlocks = [
    { type: 'VIDEO', url: 'https://example.test/video.mp4', durationSeconds: 120 },
    {
      type: 'QUIZ',
      prompt: 'Który e-mail jest podejrzany?',
      options: [
        { text: 'wsparcie@bank-oficjalny.pl', correct: false },
        { text: 'wsparcie@bank-0ficjalny.pl', correct: true },
      ],
    },
    {
      type: 'BRANCHING_SCENARIO',
      prompt: "Dostałeś maila od 'dostawcy' z pilną prośbą o płatność. Co robisz?",
      options: [
        { text: 'Klikam link i płacę od razu', outcome: 'wrong' },
        { text: 'Sprawdzam adres nadawcy i dzwonię do dostawcy', outcome: 'correct' },
      ],
    },
    { type: 'DRAG_AND_DROP', prompt: 'Posegreguj maile', items: [] },
  ];

  // Mały, dwublokowy kurs używany wyłącznie do testowania walidacji
  // kolejności/kompletności zapisu postępu, niezależnie od głównego
  // scenariusza happy-path powyżej.
  const sequenceBlocks = [
    { type: 'VIDEO', url: 'https://example.test/edge-video.mp4' },
    {
      type: 'QUIZ',
      prompt: 'Testowe pytanie',
      options: [
        { text: 'Zła odpowiedź', correct: false },
        { text: 'Dobra odpowiedź', correct: true },
      ],
    },
  ];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);

    const orgAResponse = await registerVerified(app, tenantPrisma, {
        email: orgAEmail,
        password: 'SuperSecret123!',
      });
    const orgBResponse = await registerVerified(app, tenantPrisma, {
        email: orgBEmail,
        password: 'SuperSecret123!',
      });

    orgAToken = orgAResponse.body.accessToken;
    orgBToken = orgBResponse.body.accessToken;

    const orgAUser = await tenantPrisma.runAuthLookup({ email: orgAEmail });
    orgAId = orgAUser!.organizationId;

    const course = await prisma.course.create({
      data: {
        title: `Rozpoznawanie fałszywych adresów e-mail ${uniqueSuffix}`,
        category: 'EMAIL_SECURITY',
        durationMinutes: 8,
        mandatory: true,
        contentBlocks,
      },
    });
    courseId = course.id;

    const sequenceCourse = await prisma.course.create({
      data: {
        title: `Kurs testowy kolejności bloków ${uniqueSuffix}`,
        category: 'GENERAL_AWARENESS',
        durationMinutes: 2,
        contentBlocks: sequenceBlocks,
      },
    });
    sequenceCourseId = sequenceCourse.id;

    // CourseAssignment ma FORCE RLS - fixture musi iść przez
    // TenantPrismaService, tak jak produkcyjny kod, inaczej insert
    // odrzuci RLS WITH CHECK.
    await tenantPrisma.runInOrgContext(orgAId, async (tx) => {
      await tx.courseAssignment.create({
        data: { organizationId: orgAId, userId: orgAUser!.id, courseId },
      });
      await tx.courseAssignment.create({
        data: { organizationId: orgAId, userId: orgAUser!.id, courseId: sequenceCourseId },
      });
    });
    // Celowo BRAK przypisania kursu `courseId` dla organizacji B - używane
    // w testach izolacji tenantów poniżej.
  });

  afterAll(async () => {
    await prisma.courseAssignment.deleteMany({ where: { courseId: { in: [courseId, sequenceCourseId] } } });
    await prisma.course.deleteMany({ where: { id: { in: [courseId, sequenceCourseId] } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: 'courses-e2e-test.local' } } });
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'courses-e2e-test.local' } } });
    await app.close();
  });

  it('listuje przypisane kursy ze statusem NOT_STARTED przed rozpoczęciem', async () => {
    const response = await request(app.getHttpServer())
      .get('/courses/my')
      .set('Authorization', `Bearer ${orgAToken}`)
      .expect(200);

    expect(response.body).toContainEqual(
      expect.objectContaining({ courseId, status: 'NOT_STARTED', score: null }),
    );
  });

  it('rozpoczyna kurs, zwraca contentBlocks BEZ klucza odpowiedzi i przełącza status na IN_PROGRESS', async () => {
    const response = await request(app.getHttpServer())
      .post(`/courses/${courseId}/start`)
      .set('Authorization', `Bearer ${orgAToken}`)
      .expect(200);

    expect(response.body.status).toBe('IN_PROGRESS');
    expect(response.body.currentBlockIndex).toBe(0);

    const blocks = response.body.contentBlocks;
    expect(blocks).toHaveLength(contentBlocks.length);
    // VIDEO/DRAG_AND_DROP nie mają czego ukrywać - wracają bez zmian.
    expect(blocks[0]).toEqual(contentBlocks[0]);
    expect(blocks[3]).toEqual(contentBlocks[3]);
    // QUIZ/BRANCHING_SCENARIO - treść pytania zostaje, ale klucz odpowiedzi
    // (correct/outcome) musi zniknąć zanim user odpowie.
    expect(blocks[1].options).toEqual([
      { text: 'wsparcie@bank-oficjalny.pl' },
      { text: 'wsparcie@bank-0ficjalny.pl' },
    ]);
    expect(blocks[2].options).toEqual([
      { text: 'Klikam link i płacę od razu' },
      { text: 'Sprawdzam adres nadawcy i dzwonię do dostawcy' },
    ]);
  });

  it('ocenia QUIZ i BRANCHING_SCENARIO po stronie serwera, przelicza wynik i kończy kurs', async () => {
    // Blok 0: VIDEO - samo wykonanie, bez oceny.
    const firstBlockResponse = await request(app.getHttpServer())
      .post(`/courses/${courseId}/progress`)
      .set('Authorization', `Bearer ${orgAToken}`)
      .send({ blockIndex: 0 })
      .expect(200);
    // Kurs jeszcze się nie kończy tym zapisem - brak nagrody do pokazania.
    expect(firstBlockResponse.body.gamification).toBeNull();

    // Blok 1: QUIZ - poprawna odpowiedź (index 1).
    const quizResponse = await request(app.getHttpServer())
      .post(`/courses/${courseId}/progress`)
      .set('Authorization', `Bearer ${orgAToken}`)
      .send({ blockIndex: 1, answer: 1 })
      .expect(200);
    expect(quizResponse.body.lastResult).toEqual({ blockIndex: 1, type: 'QUIZ', correct: true });
    expect(quizResponse.body.score).toBe(100);

    // Blok 2: BRANCHING_SCENARIO - błędna odpowiedź (index 0, outcome "wrong").
    const scenarioResponse = await request(app.getHttpServer())
      .post(`/courses/${courseId}/progress`)
      .set('Authorization', `Bearer ${orgAToken}`)
      .send({ blockIndex: 2, answer: 0 })
      .expect(200);
    expect(scenarioResponse.body.lastResult).toEqual({
      blockIndex: 2,
      type: 'BRANCHING_SCENARIO',
      correct: false,
    });
    expect(scenarioResponse.body.score).toBe(50); // 1 z 2 ocenianych bloków poprawna

    // Blok 3 (ostatni): DRAG_AND_DROP - bez oceny, kończy kurs.
    const finalResponse = await request(app.getHttpServer())
      .post(`/courses/${courseId}/progress`)
      .set('Authorization', `Bearer ${orgAToken}`)
      .send({ blockIndex: 3 })
      .expect(200);
    expect(finalResponse.body.status).toBe('COMPLETED');
    expect(finalResponse.body.completedAt).toEqual(expect.any(String));
    expect(finalResponse.body.score).toBe(50);
    // Ten zapis KOŃCZY kurs - gamification musi być obecne (nie null),
    // niezależnie od tego, czy jakaś odznaka faktycznie się odblokowała.
    expect(finalResponse.body.gamification).toEqual(
      expect.objectContaining({ xpGained: expect.any(Number), newLevel: expect.any(Number) }),
    );

    const listResponse = await request(app.getHttpServer())
      .get('/courses/my')
      .set('Authorization', `Bearer ${orgAToken}`)
      .expect(200);
    expect(listResponse.body).toContainEqual(
      expect.objectContaining({ courseId, status: 'COMPLETED', score: 50 }),
    );
  });

  it('zwraca 404 przy próbie rozpoczęcia kursu, który nie jest przypisany użytkownikowi', async () => {
    await request(app.getHttpServer())
      .post(`/courses/nieistniejacy-kurs-${uniqueSuffix}/start`)
      .set('Authorization', `Bearer ${orgAToken}`)
      .expect(404);
  });

  it('izolacja tenantów: organizacja B nie widzi ani nie może wystartować przypisania organizacji A', async () => {
    const listResponse = await request(app.getHttpServer())
      .get('/courses/my')
      .set('Authorization', `Bearer ${orgBToken}`)
      .expect(200);
    expect(listResponse.body).toEqual([]);

    // courseId jest realny (istnieje w katalogu kursów), ale organizacja B
    // nie ma do niego CourseAssignment - musi dostać 404, nie dane org A.
    await request(app.getHttpServer())
      .post(`/courses/${courseId}/start`)
      .set('Authorization', `Bearer ${orgBToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/courses/${courseId}/progress`)
      .set('Authorization', `Bearer ${orgBToken}`)
      .send({ blockIndex: 0 })
      .expect(404);
  });

  it('odrzuca dostęp do /courses/my bez tokena', async () => {
    await request(app.getHttpServer()).get('/courses/my').expect(401);
  });

  describe('kolejność i kompletność zapisu postępu', () => {
    it('odrzuca zapis z pominięciem kolejności bloków', async () => {
      // currentBlockIndex zaczyna się od 0 - próba zapisu bloku 1 wprost jest
      // odrzucana, nawet jeśli sam indeks mieści się w zakresie.
      await request(app.getHttpServer())
        .post(`/courses/${sequenceCourseId}/progress`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ blockIndex: 1, answer: 1 })
        .expect(400);
    });

    it('zapisuje pierwszy blok (VIDEO) bez wymaganej odpowiedzi', async () => {
      const response = await request(app.getHttpServer())
        .post(`/courses/${sequenceCourseId}/progress`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ blockIndex: 0 })
        .expect(200);
      expect(response.body.currentBlockIndex).toBe(1);
      expect(response.body.status).toBe('IN_PROGRESS');
    });

    it('odrzuca zapis postępu bez wymaganej odpowiedzi dla bloku QUIZ', async () => {
      await request(app.getHttpServer())
        .post(`/courses/${sequenceCourseId}/progress`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ blockIndex: 1 })
        .expect(400);
    });

    it('fałszywe "correct" przesłane przez klienta nie ma znaczenia - DTO go nie przyjmuje', async () => {
      // DTO nie ma pola "correct" - globalny ValidationPipe (whitelist +
      // forbidNonWhitelisted) odrzuca każdą próbę przesłania oceny przez
      // klienta, niezależnie od tego, jaki "answer" by jej towarzyszył.
      await request(app.getHttpServer())
        .post(`/courses/${sequenceCourseId}/progress`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ blockIndex: 1, answer: 0, correct: true })
        .expect(400);
    });

    it('odrzuca zapis postępu dla indeksu bloku spoza zakresu', async () => {
      await request(app.getHttpServer())
        .post(`/courses/${sequenceCourseId}/progress`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ blockIndex: 99 })
        .expect(400);
    });

    it('kończy kurs po ostatnim bloku z poprawną odpowiedzią', async () => {
      const response = await request(app.getHttpServer())
        .post(`/courses/${sequenceCourseId}/progress`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ blockIndex: 1, answer: 1 })
        .expect(200);
      expect(response.body.status).toBe('COMPLETED');
      expect(response.body.score).toBe(100);
    });

    it('odrzuca ponowny zapis postępu po ukończeniu kursu (nie da się "poprawić" wyniku po fakcie)', async () => {
      await request(app.getHttpServer())
        .post(`/courses/${sequenceCourseId}/progress`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ blockIndex: 0 })
        .expect(400);
    });
  });
});
