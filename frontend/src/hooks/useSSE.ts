import { useState, useEffect, useRef, useCallback } from 'react';

interface SSEOptions {
  onMessage?: (event: MessageEvent) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export function useSSE(url: string | null, options: SSEOptions = {}) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<Event | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef<number>(0);

  // Use refs to avoid re-creating callbacks on every render
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const connect = useCallback(() => {
    if (!url) return;

    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    try {
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsLoading(false);
        setError(null);
        retryCountRef.current = 0;
        optionsRef.current.onOpen?.();
      };

      eventSource.onmessage = (event) => {
        try {
          const parsedData = JSON.parse(event.data);
          setData(parsedData);
          optionsRef.current.onMessage?.(event);
        } catch (e) {
          console.error('Error parsing SSE message:', e);
        }
      };

      eventSource.onerror = (err) => {
        setError(err);
        optionsRef.current.onError?.(err);

        // Attempt to reconnect with exponential backoff
        if (retryCountRef.current < 5) {
          retryCountRef.current += 1;
          const retryDelay = Math.min(1000 * 2 ** retryCountRef.current, 30000); // Max 30 seconds

          reconnectTimeoutRef.current = setTimeout(() => {
            console.log(`Reconnecting to SSE... (attempt ${retryCountRef.current})`);
            connect();
          }, retryDelay);
        } else {
          setIsLoading(false);
          console.error('Max retry attempts reached for SSE connection');
        }
      };
    } catch (err) {
      setError(err as Event);
      setIsLoading(false);
      console.error('Error creating EventSource:', err);
    }
  }, [url]); // Only depend on url

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setIsLoading(false);
    options.onClose?.();
  }, [options.onClose]);

  useEffect(() => {
    if (url) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [url, connect, disconnect]);

  return {
    data,
    error,
    isLoading,
    connect,
    disconnect,
  };
}