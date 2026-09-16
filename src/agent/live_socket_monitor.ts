/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Observes the Gemini Live WebSocket so failures are visible.
 *
 * The genai SDK opens the socket and awaits its `onopen` with no rejection
 * path, so a rejected upgrade (bad API key, unknown model id) leaves
 * `live.connect()` pending forever: the UI sits on "connected" and nothing
 * ever happens. Patching the WebSocket constructor once lets us report the
 * close code and reason instead of hanging in silence.
 */

export interface LiveSocketEvent {
  type: 'open' | 'close' | 'error' | 'toolcall';
  code?: number;
  reason?: string;
  url: string;
  /** Raw functionCalls exactly as the server sent them, for 'toolcall'. */
  functionCalls?: unknown[];
}

type Listener = (event: LiveSocketEvent) => void;

const listeners = new Set<Listener>();
let installed = false;

/** True for the bidirectional Live endpoint, not unrelated app sockets. */
function isGeminiLiveUrl(url: string): boolean {
  return url.includes('BidiGenerateContent') || url.includes('google.ai.generativelanguage');
}

/** Live frames arrive as JSON text or Blob; decode either, ignoring junk. */
function readFrame(data: unknown, handle: (frame: any) => void) {
  const parse = (text: string) => {
    try {
      handle(JSON.parse(text));
    } catch {
      /* non-JSON frame */
    }
  };
  if (typeof data === 'string') {
    parse(data);
  } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
    data.text().then(parse).catch(() => {});
  } else if (data instanceof ArrayBuffer) {
    parse(new TextDecoder().decode(data));
  }
}

function emit(event: LiveSocketEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('live socket listener failed', err);
    }
  }
}

/** Installs the observer once; safe to call repeatedly. */
export function installLiveSocketMonitor() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const NativeWebSocket = window.WebSocket;

  function PatchedWebSocket(this: any, url: string | URL, protocols?: string | string[]) {
    const socket = protocols
      ? new NativeWebSocket(url as any, protocols as any)
      : new NativeWebSocket(url as any);
    const href = String(url);

    if (isGeminiLiveUrl(href)) {
      // Redact the API key that rides in the query string.
      const safeUrl = href.replace(/key=[^&]*/, 'key=***');
      socket.addEventListener('open', () => emit({ type: 'open', url: safeUrl }));
      socket.addEventListener('close', (e: CloseEvent) =>
        emit({ type: 'close', code: e.code, reason: e.reason, url: safeUrl })
      );
      socket.addEventListener('error', () => emit({ type: 'error', url: safeUrl }));
      // Surface tool calls as the server framed them, so a missing argument can
      // be attributed to the model rather than to the client pipeline.
      socket.addEventListener('message', (e: MessageEvent) => {
        readFrame(e.data, (frame) => {
          const calls = frame?.toolCall?.functionCalls;
          if (Array.isArray(calls) && calls.length > 0) {
            emit({ type: 'toolcall', url: safeUrl, functionCalls: calls });
          }
        });
      });
    }
    return socket;
  }

  PatchedWebSocket.prototype = NativeWebSocket.prototype;
  Object.assign(PatchedWebSocket, {
    CONNECTING: NativeWebSocket.CONNECTING,
    OPEN: NativeWebSocket.OPEN,
    CLOSING: NativeWebSocket.CLOSING,
    CLOSED: NativeWebSocket.CLOSED,
  });

  window.WebSocket = PatchedWebSocket as unknown as typeof WebSocket;
}

/** Subscribes to Live socket lifecycle events; returns an unsubscribe fn. */
export function onLiveSocketEvent(listener: Listener): () => void {
  installLiveSocketMonitor();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Explains a close code in terms a demo user can act on.
 */
export function describeCloseCode(code?: number, reason?: string): string {
  // The server's own reason is the most accurate thing available, so lead with
  // it and only fall back to a guess when the close carried no reason.
  if (reason && reason.trim()) {
    return `${reason.trim()} (close code ${code ?? 'unknown'})`;
  }
  switch (code) {
    case 1000:
      return 'Socket closed normally (1000).';
    case 1006:
      return 'Socket closed abnormally (1006): the upgrade was rejected. Check the API key is valid and the model id supports the Live API.';
    case 1007:
      return 'Server rejected the setup payload (1007). The model id most likely does not support bidiGenerateContent - use "load from API" to list valid Live models.';
    case 1008:
      return 'Policy violation / auth failure (1008). Check the API key.';
    case 1011:
      return 'Server error (1011).';
    default:
      return `Socket closed (code ${code ?? 'unknown'}).`;
  }
}
