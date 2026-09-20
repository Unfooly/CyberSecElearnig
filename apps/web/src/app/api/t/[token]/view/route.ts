import { proxyTracking } from '@/lib/tracking-proxy';

// Wejście na stronę lądowania symulacji (wołane przez JS strony /t/<token>, nie przez samo pobranie strony).
export async function POST(_request: Request, { params }: { params: { token: string } }) {
  return proxyTracking('view', params.token);
}
