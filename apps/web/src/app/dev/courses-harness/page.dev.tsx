import fs from 'node:fs';
import path from 'node:path';
import { notFound } from 'next/navigation';
import { DEFAULT_CONTENT_LOCALE, localizeContent, moduleSchema } from '@cyberszkolo/content';
import { contentAssetBase } from '@/lib/content-assets';
import type { CourseAssignmentSummary, CourseCatalogItem } from '@/lib/courses-types';
import CourseCatalog from '../../courses/_components/CourseCatalog';
import CourseLibrary from '../../courses/_components/CourseLibrary';
import { harnessModuleDir } from '../harness-module';

// Podgląd kart kursów (katalog i "moje kursy") z miniaturą modułu 1 (D-084), bez backendu i logowania - WYŁĄCZNIE do
// scripts/layout-check.mjs i ręcznego podglądu. Jak player-harness: plik `.dev.tsx` istnieje w routingu tylko z
// NEXT_PUBLIC_DEV_HARNESS=1 (next.config.mjs), notFound() to druga linia obrony. Z modułu bierze wyłącznie metadane (tytuł,
// podtytuł, miniatura, czas) - treść bloków nie trafia do klienta. Obok karta kursu BEZ miniatury (dotychczasowy wygląd).
// `?module=<slug>` (B-128): dowolny moduł, domyślnie moduł 1 (harness-module.ts).
export default function CoursesHarnessPage({ searchParams = {} }: { searchParams?: { module?: string } }) {
  if (process.env.NEXT_PUBLIC_DEV_HARNESS !== '1') notFound();

  const harnessModule = harnessModuleDir(searchParams.module);
  if (!harnessModule) notFound();
  // schemaVersion 6: metadane po polsku (jak kolumny kursu po imporcie).
  const contentModule = localizeContent(moduleSchema.parse(JSON.parse(fs.readFileSync(path.join(harnessModule.dir, 'module.json'), 'utf8'))), DEFAULT_CONTENT_LOCALE);
  const contentBase = process.env.CONTENT_BASE_URL
    ? contentAssetBase(process.env.CONTENT_BASE_URL, process.env.NODE_ENV === 'development')
    : `/dev/module-assets/${harnessModule.slug}`;

  const catalog: CourseCatalogItem[] = [
    {
      courseId: 'dev-1',
      title: contentModule.title,
      subtitle: contentModule.subtitle ?? null,
      thumbnail: contentModule.thumbnail ?? null,
      level: contentModule.level ?? null,
      objectives: [],
      category: contentModule.category,
      durationMinutes: contentModule.durationMinutes,
      totalBlocks: contentModule.blocks.length,
    },
    { courseId: 'dev-2', title: 'Kurs bez miniatury', subtitle: null, thumbnail: null, level: null, objectives: [], category: 'IT_HYGIENE', durationMinutes: 8, totalBlocks: 4 },
  ];
  const mine: CourseAssignmentSummary[] = catalog.map((course, index) => ({
    assignmentId: `dev-a${index}`,
    courseId: course.courseId,
    title: course.title,
    thumbnail: course.thumbnail,
    category: course.category,
    durationMinutes: course.durationMinutes,
    mandatory: index === 0,
    status: index === 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
    score: null,
    dueDate: null,
    completedAt: null,
    currentBlockIndex: index === 0 ? 3 : 0,
    totalBlocks: course.totalBlocks,
  }));

  return (
    <div className="min-h-dvh bg-paper px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-[1280px] space-y-7">
        <CourseLibrary courses={mine} contentBase={contentBase} />
        <CourseCatalog courses={catalog} contentBase={contentBase} />
      </div>
    </div>
  );
}
