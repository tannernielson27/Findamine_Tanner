/**
 * Browser side of the live leaderboard: listen for "this board changed" pings.
 *
 * The hub keeps one Realtime connection per channel however many boards are
 * listening, and never rejoins a channel that is still closing. That second
 * part matters: the Supabase client hands back the old, half-closed channel
 * when the same name is asked for again too soon (a quick remount), and that
 * channel never delivers anything.
 *
 * A ping is only a signal. Whatever the message contains is dropped here, so
 * nothing a sender puts in it can reach the page; the board data always comes
 * from the API.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { LEADERBOARD_CHANGED_EVENT } from "./leaderboard-channel";

export interface PingHandlers {
  /** The board changed: refetch soon. */
  onPing: () => void;
  /** The connection dropped and is back; pings may have been missed meanwhile. */
  onReconnect: () => void;
}

/** The Realtime connection, reduced to what the hub needs (replaceable in tests). */
export interface PingTransport {
  /**
   * Join `topic`. Returns a function that leaves it; the promise settles once
   * the topic can safely be joined again.
   */
  join(
    topic: string,
    onPing: () => void,
    onStatus: (status: string) => void
  ): () => Promise<unknown>;
}

export interface PingHub {
  /** Listen on `topic`. Returns the function that stops listening. */
  subscribe(topic: string, handlers: PingHandlers): () => void;
}

/** Realtime's subscribe status for "joined" (first time and after every rejoin). */
const SUBSCRIBED = "SUBSCRIBED";

interface TopicState {
  listeners: Set<PingHandlers>;
  /** Leaves the open connection; null while there is none. */
  leave: (() => Promise<unknown>) | null;
  /** Settles when the previous connection has finished closing. */
  closing: Promise<unknown> | null;
}

export function createPingHub(transport: PingTransport): PingHub {
  const topics = new Map<string, TopicState>();

  function open(topic: string, state: TopicState): void {
    if (state.leave || state.listeners.size === 0) return;
    let joinedBefore = false;
    let current = true;
    const eachListener = (call: (handlers: PingHandlers) => void) => {
      if (current) [...state.listeners].forEach(call);
    };
    let leave: () => Promise<unknown>;
    try {
      leave = transport.join(
        topic,
        () => eachListener((handlers) => handlers.onPing()),
        (status) => {
          if (status !== SUBSCRIBED) return;
          if (joinedBefore) eachListener((handlers) => handlers.onReconnect());
          joinedBefore = true;
        }
      );
    } catch {
      // No Realtime here (no WebSocket, blocked network): the board still
      // updates from its poll, just without the instant ping.
      return;
    }
    state.leave = () => {
      current = false;
      return leave();
    };
  }

  function close(state: TopicState): void {
    const leave = state.leave;
    if (!leave) return;
    state.leave = null;
    const closing: Promise<unknown> = leave()
      // A failed leave still ends this connection as far as the hub is concerned.
      .catch(() => undefined)
      .then(() => {
        if (state.closing === closing) state.closing = null;
      });
    state.closing = closing;
  }

  return {
    subscribe(topic: string, handlers: PingHandlers): () => void {
      const state: TopicState = topics.get(topic) ?? { listeners: new Set(), leave: null, closing: null };
      topics.set(topic, state);
      state.listeners.add(handlers);

      if (state.closing) void state.closing.then(() => open(topic, state));
      else open(topic, state);

      return () => {
        state.listeners.delete(handlers);
        if (state.listeners.size === 0) close(state);
      };
    },
  };
}

/** The hub's transport over a Supabase client's Realtime Broadcast. */
export function supabasePingTransport(client: SupabaseClient): PingTransport {
  return {
    join(topic, onPing, onStatus) {
      const channel = client
        .channel(topic)
        // The message itself is deliberately not passed on.
        .on("broadcast", { event: LEADERBOARD_CHANGED_EVENT }, () => onPing())
        .subscribe((status) => onStatus(status));
      return () => client.removeChannel(channel);
    },
  };
}
