import os
import asyncio
import threading
from typing import Any, Dict, Optional


class TradingAgentAPIAdapter:
    """
    Adapter bridging the TradingAgents core loop with external API services like FastAPI.
    Progress is broadcast to SSE subscribers via subscribe() / task stream endpoints.
    """

    def __init__(self, config=None, debug=False, event_loop: Optional[asyncio.AbstractEventLoop] = None):
        self.config = config
        self.debug = debug
        self.subscribers = set()
        self.event_history = []
        # Progress runs on executor threads; get_running_loop() fails there — use the API loop for threadsafe puts.
        self._event_loop = event_loop
        self._graph_lock = threading.Lock()
        # Set while graph.propagate runs in a worker thread; used by DELETE /api/task/{id} to cooperatively cancel.
        self._running_graph: Optional[Any] = None

    def _progress_callback(self, event_type: str, data: Dict[str, Any]):
        """
        Hook injected into the Agent loop to capture internal execution events.
        Broadcasts events with unique IDs to all active subscriber queues.
        """
        import time
        import random

        # Generate a unique ID for deduplication
        msg_id = f"{int(time.time() * 1000)}-{random.randint(1000, 9999)}"
        msg = {"id": msg_id, "event": event_type, "data": data}
        self.event_history.append(msg)

        # Broadcast to all active subscribers
        enqueued = 0
        for q in list(self.subscribers):
            try:
                loop = self._event_loop
                if loop is not None and loop.is_running():
                    loop.call_soon_threadsafe(q.put_nowait, msg)
                    enqueued += 1
                    continue
                try:
                    loop = asyncio.get_running_loop()
                except RuntimeError:
                    continue
                if loop.is_running():
                    loop.call_soon_threadsafe(q.put_nowait, msg)
                    enqueued += 1
                else:
                    q.put_nowait(msg)
                    enqueued += 1
            except Exception:
                # If putting fails (e.g. loop closed), we'll handle it on the subscriber side
                pass

        # Never log payload `data` here—it may contain user/LLM content; keys are not in SSE events.
        if os.environ.get("TA_DEBUG_SSE") == "1":
            n_sub = len(self.subscribers)
            print(
                f"[TA_DEBUG_SSE] progress event enqueued: event={event_type!r} id={msg_id} "
                f"queues_ok={enqueued}/{n_sub} history_len={len(self.event_history)}",
                flush=True,
            )
            if n_sub == 0:
                print(
                    "[TA_DEBUG_SSE] no active SSE subscriber yet (event stored in history only)",
                    flush=True,
                )

    async def subscribe(self) -> asyncio.Queue:
        """Create a new subscriber queue and populate it with existing event history."""
        q = asyncio.Queue()
        for msg in self.event_history:
            await q.put(msg)
        self.subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        """Remove a subscriber queue."""
        self.subscribers.discard(q)

    def attach_running_graph(self, graph: Any) -> None:
        """Register the graph instance for the current executor run (call before run_in_executor)."""
        with self._graph_lock:
            self._running_graph = graph

    def detach_running_graph(self) -> None:
        """Clear graph reference after propagate finishes or is skipped."""
        with self._graph_lock:
            self._running_graph = None

    def request_cancel(self) -> bool:
        """
        Ask the running graph to stop (TradingAgentsGraph.cancel_task).
        Safe to call from the event-loop thread while propagate runs in an executor.
        Returns True if a graph was notified, False if none is registered yet.
        """
        with self._graph_lock:
            g = self._running_graph
        if g is None:
            return False
        cancel = getattr(g, "cancel_task", None)
        if callable(cancel):
            cancel()
            return True
        return False
