import { DurableObject } from 'cloudflare:workers';
import contentJson from '../generated/content.json';
import { ActionError, initialState, nextDeadline, reduce } from '../shared/game';
import type { Action, ClientMessage, Content, GameState, Role, ServerMessage } from '../shared/types';
import { buildView } from '../shared/view';
import type { Env } from './index';

const content = contentJson as unknown as Content;
const MAX_HISTORY = 40;
/** Actions the display (buzzer PC) is allowed to send. Everything else needs the host PIN. */
const DISPLAY_ACTIONS = new Set<Action['type']>(['buzz']);

/**
 * One instance per room code. Holds the authoritative game state and relays it to every
 * connected display and host over hibernatable WebSockets (no cost while idle).
 */
export class GameRoom extends DurableObject<Env> {
  private state: GameState = initialState();
  private history: GameState[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<GameState>('state');
      // Drop state that refers to a game that no longer exists after a content update.
      if (saved && (!saved.gameId || content.games[saved.gameId])) this.state = saved;
      this.history = (await ctx.storage.get<GameState[]>('history')) ?? [];
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  async fetch(req: Request): Promise<Response> {
    const role = (new URL(req.url).searchParams.get('role') ?? 'display') as Role;
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [role]);
    this.sendState(pair[1], role);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const role = (this.ctx.getTags(ws)[0] ?? 'display') as Role;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.send(ws, { t: 'error', message: 'Bad message' });
    }

    if (msg.t === 'ping') return this.send(ws, { t: 'pong', now: Date.now() });

    if (msg.t === 'undo') {
      if (role !== 'host') return this.send(ws, { t: 'error', message: 'Not allowed' });
      const prev = this.history.pop();
      if (!prev) return this.send(ws, { t: 'error', message: 'Nothing to undo' });
      // Keep seq increasing so clients never ignore the restored state; drop the old event so sounds don't replay.
      this.state = { ...prev, seq: this.state.seq + 1, event: null };
      return this.commit();
    }

    if (msg.t !== 'action' || !msg.action || typeof msg.action.type !== 'string') return;
    if (role !== 'host' && !DISPLAY_ACTIONS.has(msg.action.type)) {
      return this.send(ws, { t: 'error', message: 'Not allowed' });
    }
    this.apply(msg.action, ws);
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code, 'closing');
    } catch {
      /* already closed */
    }
  }

  async alarm(): Promise<void> {
    this.apply({ type: 'tick' });
  }

  private apply(action: Action, from?: WebSocket): void {
    let next: GameState;
    try {
      next = reduce(content, this.state, action, Date.now());
    } catch (e) {
      if (from) this.send(from, { t: 'error', message: e instanceof ActionError ? e.message : 'Action failed' });
      if (!(e instanceof ActionError)) console.error(e);
      return;
    }
    if (next === this.state) return; // ignored (e.g. a late buzz)
    if (action.type !== 'tick' && action.type !== 'media') {
      this.history.push(this.state);
      if (this.history.length > MAX_HISTORY) this.history.shift();
    }
    this.state = next;
    this.commit();
  }

  private commit(): void {
    this.broadcast();
    // Writes are coalesced by the runtime; no need to await before broadcasting.
    this.ctx.storage.put({ state: this.state, history: this.history });
    const deadline = nextDeadline(this.state);
    if (deadline) this.ctx.storage.setAlarm(deadline);
    else this.ctx.storage.deleteAlarm();
  }

  private broadcast(): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.sendState(ws, (this.ctx.getTags(ws)[0] ?? 'display') as Role);
    }
  }

  private sendState(ws: WebSocket, role: Role): void {
    this.send(ws, {
      t: 'state',
      state: this.state,
      view: buildView(content, this.state, role),
      now: Date.now(),
      canUndo: role === 'host' && this.history.length > 0,
    });
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket went away */
    }
  }
}
