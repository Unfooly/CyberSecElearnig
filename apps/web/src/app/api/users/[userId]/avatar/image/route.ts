import { getAvatarImage } from '@/lib/avatar-image-routes';

// Avatar innego użytkownika (ranking, tabele). O tym, czy wolno go pokazać, decyduje apps/api:
// filtruje po organizationId z tokena, więc avatara z obcej organizacji nie da się pobrać.
export async function GET(_request: Request, { params }: { params: { userId: string } }) {
  return getAvatarImage(params.userId);
}
