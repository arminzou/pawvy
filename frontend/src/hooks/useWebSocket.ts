import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type WsMessage = { type: string; data?: unknown };
export type WsStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

const DEFAULT_WS_BASE = (() => {
  if (typeof window === 'undefined') return 'ws://localhost:3001/ws';
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws`;
})();

const RAW_WS_BASE = ((import.meta as unknown as { env?: { VITE_WS_BASE?: string } }).env?.VITE_WS_BASE) ?? '';
const WS_BASE = RAW_WS_BASE.trim() ? RAW_WS_BASE : DEFAULT_WS_BASE;
const API_KEY = ((import.meta as unknown as { env?: { VITE_PAWVY_API_KEY?: string } }).env?.VITE_PAWVY_API_KEY) ?? '';
const WS_DEBUG = (() => {
  const raw = String(((import.meta as unknown as { env?: { VITE_WS_DEBUG?: string } }).env?.VITE_WS_DEBUG) ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
})();

function wsDebug(...args: unknown[]) {
  if (!WS_DEBUG) return;
  console.info('[ws]', ...args);
}

function withApiKey(url: string) {
  if (!API_KEY) return url;
  try {
    const u = new URL(url, typeof window === 'undefined' ? 'ws://localhost' : window.location.href);
    u.searchParams.set('apiKey', API_KEY);
    return u.toString();
  } catch {
    // fallback: naive append
    return url.includes('?') ? `${url}&apiKey=${encodeURIComponent(API_KEY)}` : `${url}?apiKey=${encodeURIComponent(API_KEY)}`;
  }
}

export function useWebSocket(opts?: { onMessage?: (msg: WsMessage) => void }) {
  const [status, setStatus] = useState<WsStatus>('connecting');
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const [lastReceivedAt, setLastReceivedAt] = useState<number | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [connectEpoch, setConnectEpoch] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef<((msg: WsMessage) => void) | undefined>(opts?.onMessage);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const everConnectedRef = useRef(false);

  const url = useMemo(() => withApiKey(WS_BASE), []);
  const reconnectNow = useCallback(() => {
    setConnectEpoch((value) => value + 1);
  }, []);

  useEffect(() => {
    onMessageRef.current = opts?.onMessage;
  }, [opts?.onMessage]);

  useEffect(() => {
    let cancelled = false;

    function clearReconnectTimer() {
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function connect(nextStatus: WsStatus) {
      if (cancelled) return;
      clearReconnectTimer();

      setStatus(nextStatus);
      wsDebug('connect:start', { url, nextStatus, attempt: attemptRef.current + 1 });

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        everConnectedRef.current = true;
        attemptRef.current = 0;
        setReconnectAttempts(0);
        setStatus('connected');
        wsDebug('connect:open');
      };

      ws.onclose = (event) => {
        if (cancelled) return;
        wsDebug('connect:close', { code: event.code, reason: event.reason, wasClean: event.wasClean });

        // If we ever had a successful connection, treat subsequent connects as "reconnecting".
        setStatus(everConnectedRef.current ? 'reconnecting' : 'disconnected');

        attemptRef.current += 1;
        setReconnectAttempts(attemptRef.current);
        const backoffMs = Math.min(5000, 500 * Math.max(1, attemptRef.current));
        wsDebug('connect:retry_scheduled', { backoffMs, attempt: attemptRef.current });
        reconnectTimerRef.current = window.setTimeout(() => connect('reconnecting'), backoffMs);
      };

      ws.onerror = (event) => {
        if (cancelled) return;
        wsDebug('connect:error', { type: event.type });
        // onclose will also fire; keep UI conservative.
        setStatus((s) => (s === 'connected' ? 'reconnecting' : s));
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as WsMessage;
          setLastMessage(msg);
          setLastReceivedAt(Date.now());
          onMessageRef.current?.(msg);
        } catch {
          // ignore
        }
      };
    }

    connect('connecting');

    return () => {
      cancelled = true;
      clearReconnectTimer();
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, [url, connectEpoch]);

  return { status, connected: status === 'connected', lastMessage, lastReceivedAt, reconnectAttempts, reconnectNow };
}
