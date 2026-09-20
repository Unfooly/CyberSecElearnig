import { proxyTracking } from '@/lib/tracking-proxy';

// Wysłanie formularza na stronie lądowania symulacji. Ciało żądania NIE jest czytane ani przekazywane dalej.
export async function POST(_request: Request, { params }: { params: { token: string } }) {
  return proxyTracking('submit', params.token);
}
