import { getAvatarImage } from '@/lib/avatar-image-routes';

// Avatar innego użytkownika (ranking, tabele). O tym, czy wolno go pokazać, decyduje apps/api:
// filtruje po organizationId z tokena, więc avatara z obcej organizacji nie da się pobrać.
//
// Segment MUSI nazywać się `[id]` - tak samo jak sąsiednie trasy `/api/users/[id]/*`. Next.js
// wymaga tej samej nazwy parametru na tym samym poziomie ścieżki i przy `[userId]` wywala się
// dopiero w `next build` ("You cannot use different slug names for the same dynamic path"),
// a nie w `next dev`, lincie ani testach.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return getAvatarImage(params.id);
}
