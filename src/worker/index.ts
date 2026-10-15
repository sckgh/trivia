import contentJson from '../generated/content.json';
import type { Content } from '../shared/types';
export { GameRoom } from './room';

export interface Env {
  ASSETS: Fetcher;
  ROOM: DurableObjectNamespace;
  HOST_PIN?: string;
}

const content = contentJson as unknown as Content;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/api/games') {
      const games = Object.values(content.games).map((g) => ({ id: g.id, title: g.title }));
      return Response.json(games);
    }

    if (url.pathname === '/api/pin' && req.method === 'POST') {
      const { pin } = (await req.json().catch(() => ({}))) as { pin?: string };
      if (!env.HOST_PIN) return new Response('HOST_PIN is not configured on the server', { status: 500 });
      return new Response(null, { status: timingSafeEqual(String(pin ?? ''), env.HOST_PIN) ? 204 : 403 });
    }

    const m = url.pathname.match(/^\/api\/room\/([A-Za-z0-9-]{1,16})\/ws$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      const role = url.searchParams.get('role');
      if (role !== 'display' && role !== 'host') return new Response('Bad role', { status: 400 });
      if (role === 'host') {
        if (!env.HOST_PIN) return new Response('HOST_PIN is not configured on the server', { status: 500 });
        if (!timingSafeEqual(url.searchParams.get('pin') ?? '', env.HOST_PIN)) {
          return new Response('Wrong PIN', { status: 403 });
        }
      }
      const room = m[1].toUpperCase();
      const stub = env.ROOM.get(env.ROOM.idFromName(room));
      return stub.fetch(new Request(`https://room/${room}?role=${role}`, req));
    }

    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}
