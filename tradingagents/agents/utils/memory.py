"""Financial situation memory using BM25 for lexical similarity matching.

Uses BM25 (Best Matching 25) algorithm for retrieval - no API calls,
no token limits, works offline with any LLM provider.

Memory is optionally persisted to SQLite so lessons survive across
process restarts and separate ``TradingAgentsGraph`` instances.
"""

from rank_bm25 import BM25Okapi
from typing import List, Tuple
import json
import logging
import os
import re
import sqlite3
from pathlib import Path

_log = logging.getLogger(__name__)


def _memory_db_path() -> Path:
    root = Path(__file__).resolve().parents[3]
    data_dir = Path(os.environ.get("TRADINGAGENTS_DATA_DIR", str(root / "data")))
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "agent_memory.db"


def _init_memory_db(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS agent_memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_name TEXT NOT NULL,
            situation TEXT NOT NULL,
            recommendation TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_memories_name ON agent_memories(memory_name)"
    )
    conn.commit()


class FinancialSituationMemory:
    """Memory system for storing and retrieving financial situations using BM25.

    When ``persist=True`` (the default), memories are also written to and loaded
    from a SQLite database so they survive across process restarts.
    """

    def __init__(self, name: str, config: dict = None, persist: bool = True):
        """Initialize the memory system.

        Args:
            name: Name identifier for this memory instance
            config: Configuration dict (kept for API compatibility)
            persist: If True, load/save memories to SQLite on disk
        """
        self.name = name
        self.persist = persist
        self.documents: List[str] = []
        self.recommendations: List[str] = []
        self.bm25 = None

        if self.persist:
            self._load_from_db()

    def _tokenize(self, text: str) -> List[str]:
        """Tokenize text for BM25 indexing.

        Simple whitespace + punctuation tokenization with lowercasing.
        """
        # Lowercase and split on non-alphanumeric characters
        tokens = re.findall(r'\b\w+\b', text.lower())
        return tokens

    def _rebuild_index(self):
        """Rebuild the BM25 index after adding documents."""
        if self.documents:
            tokenized_docs = [self._tokenize(doc) for doc in self.documents]
            self.bm25 = BM25Okapi(tokenized_docs)
        else:
            self.bm25 = None

    def add_situations(self, situations_and_advice: List[Tuple[str, str]]):
        """Add financial situations and their corresponding advice.

        Args:
            situations_and_advice: List of tuples (situation, recommendation)
        """
        for situation, recommendation in situations_and_advice:
            self.documents.append(situation)
            self.recommendations.append(recommendation)

        # Rebuild BM25 index with new documents
        self._rebuild_index()

        if self.persist:
            self._save_to_db(situations_and_advice)

    def get_memories(self, current_situation: str, n_matches: int = 1) -> List[dict]:
        """Find matching recommendations using BM25 similarity.

        Args:
            current_situation: The current financial situation to match against
            n_matches: Number of top matches to return

        Returns:
            List of dicts with matched_situation, recommendation, and similarity_score
        """
        if not self.documents or self.bm25 is None:
            return []

        # Tokenize query
        query_tokens = self._tokenize(current_situation)

        # Get BM25 scores for all documents
        scores = self.bm25.get_scores(query_tokens)

        # Get top-n indices sorted by score (descending)
        top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:n_matches]

        # Build results
        results = []
        max_score = max(scores) if max(scores) > 0 else 1  # Normalize scores

        for idx in top_indices:
            # Normalize score to 0-1 range for consistency
            normalized_score = scores[idx] / max_score if max_score > 0 else 0
            results.append({
                "matched_situation": self.documents[idx],
                "recommendation": self.recommendations[idx],
                "similarity_score": normalized_score,
            })

        return results

    def clear(self):
        """Clear all stored memories."""
        self.documents = []
        self.recommendations = []
        self.bm25 = None
        if self.persist:
            self._clear_db()

    # ------------------------------------------------------------------
    # SQLite persistence helpers
    # ------------------------------------------------------------------

    def _load_from_db(self) -> None:
        try:
            db = _memory_db_path()
            if not db.exists():
                return
            conn = sqlite3.connect(str(db), check_same_thread=False)
            _init_memory_db(conn)
            cur = conn.execute(
                "SELECT situation, recommendation FROM agent_memories WHERE memory_name = ? ORDER BY id",
                (self.name,),
            )
            for row in cur.fetchall():
                self.documents.append(row[0])
                self.recommendations.append(row[1])
            conn.close()
            self._rebuild_index()
            if self.documents:
                _log.debug("Loaded %d memories for %s", len(self.documents), self.name)
        except Exception as exc:
            _log.debug("Failed to load memories for %s: %s", self.name, exc)

    def _save_to_db(self, pairs: List[Tuple[str, str]]) -> None:
        try:
            conn = sqlite3.connect(str(_memory_db_path()), check_same_thread=False)
            _init_memory_db(conn)
            conn.executemany(
                "INSERT INTO agent_memories (memory_name, situation, recommendation) VALUES (?, ?, ?)",
                [(self.name, sit, rec) for sit, rec in pairs],
            )
            conn.commit()
            conn.close()
        except Exception as exc:
            _log.debug("Failed to save memories for %s: %s", self.name, exc)

    def _clear_db(self) -> None:
        try:
            conn = sqlite3.connect(str(_memory_db_path()), check_same_thread=False)
            _init_memory_db(conn)
            conn.execute("DELETE FROM agent_memories WHERE memory_name = ?", (self.name,))
            conn.commit()
            conn.close()
        except Exception as exc:
            _log.debug("Failed to clear memories for %s: %s", self.name, exc)


if __name__ == "__main__":
    # Example usage
    matcher = FinancialSituationMemory("test_memory")

    # Example data
    example_data = [
        (
            "High inflation rate with rising interest rates and declining consumer spending",
            "Consider defensive sectors like consumer staples and utilities. Review fixed-income portfolio duration.",
        ),
        (
            "Tech sector showing high volatility with increasing institutional selling pressure",
            "Reduce exposure to high-growth tech stocks. Look for value opportunities in established tech companies with strong cash flows.",
        ),
        (
            "Strong dollar affecting emerging markets with increasing forex volatility",
            "Hedge currency exposure in international positions. Consider reducing allocation to emerging market debt.",
        ),
        (
            "Market showing signs of sector rotation with rising yields",
            "Rebalance portfolio to maintain target allocations. Consider increasing exposure to sectors benefiting from higher rates.",
        ),
    ]

    # Add the example situations and recommendations
    matcher.add_situations(example_data)

    # Example query
    current_situation = """
    Market showing increased volatility in tech sector, with institutional investors
    reducing positions and rising interest rates affecting growth stock valuations
    """

    try:
        recommendations = matcher.get_memories(current_situation, n_matches=2)

        for i, rec in enumerate(recommendations, 1):
            print(f"\nMatch {i}:")
            print(f"Similarity Score: {rec['similarity_score']:.2f}")
            print(f"Matched Situation: {rec['matched_situation']}")
            print(f"Recommendation: {rec['recommendation']}")

    except Exception as e:
        print(f"Error during recommendation: {str(e)}")
