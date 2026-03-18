import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { applyUpdate, encodeStateAsUpdate, encodeStateVector } from 'yjs';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

function uint8ToBase64(u8: Uint8Array): string {
  // Avoid stack overflow for large updates by chunking
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type BroadcastPayload =
  | { t: 'sync_step1'; sv: string; from: string }
  | { t: 'sync_step2'; u: string; to: string; from: string }
  | { t: 'update'; u: string; from: string }
  | { t: 'awareness'; u: string; from: string };

export class SupabaseYjsProvider {
  private supabase: SupabaseClient;
  private channelName: string;
  private channel: RealtimeChannel | null = null;
  private doc: Y.Doc;
  public awareness: Awareness;
  private clientId: string;
  private destroyed = false;
  private localUpdateHandler: ((update: Uint8Array, origin: any) => void) | null = null;
  private awarenessUpdateHandler: (({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: any) => void) | null = null;

  constructor(opts: {
    supabase: SupabaseClient;
    channelName: string;
    doc: Y.Doc;
    awareness?: Awareness;
    clientId: string;
  }) {
    this.supabase = opts.supabase;
    this.channelName = opts.channelName;
    this.doc = opts.doc;
    this.awareness = opts.awareness ?? new Awareness(this.doc);
    this.clientId = opts.clientId;
  }

  connect() {
    if (this.destroyed) return;
    if (this.channel) return;

    const channel = this.supabase.channel(this.channelName, {
      config: { broadcast: { self: false } },
    });
    this.channel = channel;

    // Defer handling off the Realtime _trigger stack to avoid re-entrancy
    // (RangeError: Maximum call stack size exceeded in some client versions).
    channel.on('broadcast', { event: 'yjs' }, (evt: any) => {
      const raw = (evt?.payload ?? evt) as BroadcastPayload | undefined;
      queueMicrotask(() => {
        if (this.destroyed) return;
        const payload = raw;
        if (!payload || typeof payload !== 'object') return;
        if ((payload as any).from === this.clientId) return;
        if (payload.t === 'sync_step1') {
          const sv = base64ToUint8(payload.sv);
          const u = encodeStateAsUpdate(this.doc, sv);
          const reply: BroadcastPayload = {
            t: 'sync_step2',
            u: uint8ToBase64(u),
            to: payload.from,
            from: this.clientId,
          };
          void this.send(reply);
          return;
        }
        if (payload.t === 'sync_step2') {
          if (payload.to !== this.clientId) return;
          applyUpdate(this.doc, base64ToUint8(payload.u), this);
          return;
        }
        if (payload.t === 'update') {
          applyUpdate(this.doc, base64ToUint8(payload.u), this);
          return;
        }
        if (payload.t === 'awareness') {
          applyAwarenessUpdate(this.awareness, base64ToUint8(payload.u), this);
        }
      });
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // Sync handshake
        const sv = encodeStateVector(this.doc);
        const msg: BroadcastPayload = { t: 'sync_step1', sv: uint8ToBase64(sv), from: this.clientId };
        void this.send(msg);
      }
    });

    this.localUpdateHandler = (update: Uint8Array, origin: any) => {
      if (origin === this) return;
      const msg: BroadcastPayload = { t: 'update', u: uint8ToBase64(update), from: this.clientId };
      void this.send(msg);
    };
    this.doc.on('update', this.localUpdateHandler);

    this.awarenessUpdateHandler = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown
    ) => {
      // Remote applyAwarenessUpdate(..., this) must not echo back (storm / re-entrancy).
      if (origin === this) return;
      const changed = added.concat(updated, removed);
      if (changed.length === 0) return;
      const u = encodeAwarenessUpdate(this.awareness, changed);
      const msg: BroadcastPayload = { t: 'awareness', u: uint8ToBase64(u), from: this.clientId };
      void this.send(msg);
    };
    this.awareness.on('update', this.awarenessUpdateHandler);
  }

  private async send(payload: BroadcastPayload) {
    if (this.destroyed) return;
    const channel = this.channel;
    if (!channel) return;
    try {
      // Explicit REST broadcast — avoids deprecated send() → REST fallback warning
      await channel.httpSend('yjs', payload);
    } catch {
      // ignore (network / channel closed)
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      const states = Array.from(this.awareness.getStates().keys());
      const u = encodeAwarenessUpdate(this.awareness, states);
      void this.send({ t: 'awareness', u: uint8ToBase64(u), from: this.clientId });
    } catch {
      /* ignore */
    }
    if (this.localUpdateHandler) this.doc.off('update', this.localUpdateHandler);
    if (this.awarenessUpdateHandler) this.awareness.off('update', this.awarenessUpdateHandler);
    if (this.channel) {
      try {
        this.channel.unsubscribe();
      } catch {
        /* ignore */
      }
    }
    this.channel = null;
  }
}

