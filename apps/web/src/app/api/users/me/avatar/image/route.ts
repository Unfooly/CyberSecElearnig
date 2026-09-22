import { NextRequest } from 'next/server';
import { deleteAvatarImage, getAvatarImage, uploadAvatarImage } from '@/lib/avatar-image-routes';

// Własny avatar z pliku (D-067): wgranie, usunięcie i podgląd WŁASNEGO obrazka.
// "me" rozwiązujemy po stronie serwera z tokena - klient nie musi znać swojego id.
export async function POST(request: NextRequest) {
  return uploadAvatarImage(request);
}

export async function DELETE() {
  return deleteAvatarImage();
}

export async function GET() {
  return getAvatarImage('me');
}
