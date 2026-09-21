import { NextResponse } from 'next/server';
import { EMBED_DOCUMENT_HEADERS, proxyEmbeddedDocument } from '@/lib/bff';
import { isSafeId } from '@/lib/safe-id';

// Dokument bloku EMBEDDED_HTML ładowany przez <iframe sandbox="allow-scripts"> (EmbeddedHtmlBlock). Trasa leży pod /api, więc middleware nie
// nakłada na nią CSP strony: nagłówki dokumentu (restrykcyjne CSP, sandbox, nosniff, no-store) ustawia proxyEmbeddedDocument. Kontrola
// dostępu (właściciel przypisania, blok bieżący lub wcześniejszy, RLS) jest w apps/api; identyfikatory tylko po isSafeId.
export async function GET(_request: Request, { params }: { params: { courseId: string; blockId: string } }) {
  if (!isSafeId(params.courseId) || !isSafeId(params.blockId)) {
    return new NextResponse('<!doctype html><meta charset="utf-8"><p>Nieprawidłowy identyfikator.</p>', { status: 400, headers: EMBED_DOCUMENT_HEADERS });
  }
  return proxyEmbeddedDocument(`/courses/${params.courseId}/blocks/${params.blockId}/embed`);
}
