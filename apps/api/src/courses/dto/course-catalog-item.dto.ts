import { CourseCategory } from '@prisma/client';

// Pozycja katalogu (GET /courses/catalog): kurs globalny, na który wywołujący nie ma jeszcze przypisania - bez treści
// bloków (D-065). "Rozpocznij" tworzy samoobsługowe przypisanie (POST /courses/:id/self-assign).
export class CourseCatalogItemDto {
  courseId!: string;
  title!: string;
  subtitle!: string | null;
  // Ścieżka zasobu miniatury (D-084) - klient składa adres z CONTENT_BASE_URL (contentAssetUrl); null = karta bez miniatury.
  thumbnail!: string | null;
  level!: string | null;
  objectives!: string[];
  category!: CourseCategory;
  durationMinutes!: number;
  totalBlocks!: number;
}
