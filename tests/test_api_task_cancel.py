"""
Integration tests: DELETE /api/task/{id} must call TradingAgentsGraph.cancel_task()
so propagate exits cooperatively (not only update in-memory task status).
"""

from __future__ import annotations

import time
import threading
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


class SlowCancellableGraph:
    """Mimics TradingAgentsGraph: cancel_task sets flag; propagate loop observes it."""

    def __init__(self, *args, **kwargs):
        self.cancel_requested = False
        self.propagate_entered = threading.Event()
        self.iterations = 0

    def cancel_task(self) -> None:
        self.cancel_requested = True

    def propagate(self, ticker: str, trade_date: str):
        self.propagate_entered.set()
        while self.iterations < 10_000:
            if self.cancel_requested:
                return None, "CANCELLED"
            time.sleep(0.002)
            self.iterations += 1
        return {"final_trade_decision": "hold"}, "neutral"


@pytest.fixture
def client() -> TestClient:
    from app.api.main import app

    return TestClient(app)


def test_delete_cancel_invokes_graph_cancel_and_propagate_exits_early(client: TestClient) -> None:
    fake = SlowCancellableGraph()
    with patch("tradingagents.graph.trading_graph.TradingAgentsGraph", return_value=fake):
        r = client.post(
            "/api/analyze",
            json={"ticker": "TEST", "analysis_date": "2024-01-15"},
        )
        assert r.status_code == 200
        task_id = r.json()["task_id"]
        assert fake.propagate_entered.wait(timeout=5.0), "propagate should start"
        time.sleep(0.05)
        c = client.delete(f"/api/task/{task_id}")
        assert c.status_code == 200
        assert fake.cancel_requested is True

        deadline = time.time() + 5.0
        while time.time() < deadline:
            st = client.get(f"/api/task/{task_id}").json()
            if st["status"] == "cancelled":
                break
            time.sleep(0.05)
        else:
            pytest.fail("task did not reach cancelled status")

        assert fake.iterations < 500, (
            "propagate should stop soon after cancel_task(), not run full loop"
        )


class FastCompleteGraph:
    """Returns immediately so the task reaches completed without LLM."""

    def __init__(self, *args, **kwargs):
        pass

    def cancel_task(self) -> None:
        pass

    def propagate(self, ticker: str, trade_date: str):
        return {"final_trade_decision": "Hold for testing."}, "neutral"


def test_delete_completed_task_returns_400(client: TestClient) -> None:
    with patch(
        "tradingagents.graph.trading_graph.TradingAgentsGraph",
        return_value=FastCompleteGraph(),
    ):
        r = client.post(
            "/api/analyze",
            json={"ticker": "DONE", "analysis_date": "2024-01-15"},
        )
        task_id = r.json()["task_id"]
        deadline = time.time() + 5.0
        while time.time() < deadline:
            st = client.get(f"/api/task/{task_id}").json()
            if st["status"] == "completed":
                break
            time.sleep(0.02)
        else:
            pytest.fail("task did not complete")

    bad = client.delete(f"/api/task/{task_id}")
    assert bad.status_code == 400
