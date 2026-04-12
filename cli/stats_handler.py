"""CLI re-exports the shared stats handler (single implementation)."""

from tradingagents.utils.stats_handler import StatsCallbackHandler

__all__ = ["StatsCallbackHandler"]
