import { NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { isSafeId } from '@/lib/safe-id';

// Stan częściowy sceny (SCENE_HOTSPOTS, D-128: POST /courses/:id/blocks/:blockId/explore) - obejrzane przedmioty i zabrane dowody bieżącego
// bloku. Zmienia stan (postęp przypisania), więc proxyAuthenticated wymaga żądania z naszej własnej strony (CSRF). Ścieżka stała po
// stronie serwera (identyfikatory po isSafeId), ciało z allowlisty: { visited, noted } - listy identyfikatorów (isSafeId; dokładny format
// i zgodność z treścią bloku - API). Tożsamość i organizacja wyłącznie z ciasteczka (JWT). Statusy API (400, 404, 429) przechodzą 1:1.
const MAX_ITEMS = 50;
const isIdList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= MAX_ITEMS && value.every((id) => typeof id === 'string' && isSafeId(id));

export async function POST(request: Request, { params }: { params: { courseId: string; blockId: string } }) {
  if (!isSafeId(params.courseId) || !isSafeId(params.blockId)) {
    return NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { visited?: unknown; noted?: unknown } | null;
  if (!body || !isIdList(body.visited) || !isIdList(body.noted)) {
    return NextResponse.json({ message: 'Nieprawidłowe żądanie.' }, { status: 400 });
  }

  return proxyAuthenticated('POST', `/courses/${params.courseId}/blocks/${params.blockId}/explore`, {
    visited: body.visited,
    noted: body.noted,
  });
}
