# TradingAgents/graph/trading_graph.py

import logging
import os
import asyncio
import time
from pathlib import Path
import json
from datetime import date
from typing import Dict, Any, Tuple, List, Optional, Callable

from langgraph.prebuilt import ToolNode
from langchain_core.messages import AIMessage, ToolMessage, HumanMessage

from tradingagents.llm_clients import create_llm_client

from tradingagents.agents import *
from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.agents.utils.memory import FinancialSituationMemory
from tradingagents.agents.utils.agent_states import (
    AgentState,
    InvestDebateState,
    RiskDebateState,
)
from tradingagents.dataflows.config import set_config, reset_config

_log_graph = logging.getLogger(__name__)

# Import the new abstract tool methods from agent_utils
from tradingagents.agents.utils.agent_utils import (
    get_stock_data,
    get_indicators,
    get_fundamentals,
    get_balance_sheet,
    get_cashflow,
    get_income_statement,
    get_news,
    get_insider_transactions,
    get_global_news
)

from .conditional_logic import ConditionalLogic
from .setup import GraphSetup
from .propagation import Propagator
from .reflection import Reflector
from .signal_processing import SignalProcessor


class TradingAgentsGraph:
    """Main class that orchestrates the trading agents framework."""

    # Analyst ordering (matches CLI ANALYST_ORDER)
    ANALYST_ORDER = ["market", "social", "news", "fundamentals"]

    # Analyst name mapping (matches CLI ANALYST_AGENT_NAMES)
    ANALYST_AGENT_NAMES = {
        "market": "Market Analyst",
        "social": "Social Analyst",
        "news": "News Analyst",
        "fundamentals": "Fundamentals Analyst",
    }

    # Report section mapping: section -> (analyst_key, finalizing_agent)
    # analyst_key: which analyst selection controls this section (None = always included)
    # finalizing_agent: which agent must be "completed" for this report to count as done
    REPORT_SECTIONS = {
        "market_report": ("market", "Market Analyst"),
        "sentiment_report": ("social", "Social Analyst"),
        "news_report": ("news", "News Analyst"),
        "fundamentals_report": ("fundamentals", "Fundamentals Analyst"),
        "investment_plan": (None, "Research Manager"),
        "trader_investment_plan": (None, "Trader"),
        "final_trade_decision": (None, "Portfolio Manager"),
    }

    # Report key to section mapping (matches CLI ANALYST_REPORT_MAP)
    ANALYST_REPORT_MAP = {
        "market": "market_report",
        "social": "sentiment_report",
        "news": "news_report",
        "fundamentals": "fundamentals_report",
    }

    def __init__(
        self,
        selected_analysts=["market", "social", "news", "fundamentals"],
        debug=False,
        config: Dict[str, Any] = None,
        callbacks: Optional[List] = None,
        progress_callback=None,
        loop=None,
    ):
        """Initialize the trading agents graph and components.

        Args:
            selected_analysts: List of analyst types to include
            debug: Whether to run in debug mode
            config: Configuration dictionary. If None, uses default config
            callbacks: Optional list of callback handlers (e.g., for tracking LLM/tool stats)
            progress_callback: Optional callback function for streaming agent progress
        """
        self.debug = debug
        self.config = config or DEFAULT_CONFIG
        self.selected_analysts = selected_analysts
        self.callbacks = callbacks or []
        self._stats_handler = None
        for c in self.callbacks:
            if hasattr(c, "get_stats") and callable(getattr(c, "get_stats", None)):
                self._stats_handler = c
                break
        self.progress_callback = progress_callback
        if loop is not None:
            self.loop = loop
        else:
            try:
                self.loop = asyncio.get_running_loop()
            except RuntimeError:
                self.loop = asyncio.new_event_loop()
                asyncio.set_event_loop(self.loop)
        self.cancel_requested = False
        self.current_task_id = None

        # State tracking for CLI-consistent behavior
        self.agent_status = {}
        self.report_sections = {}
        self._last_message_id = None

        # Runtime config is bound at execution boundary for task isolation

        # Create necessary directories
        os.makedirs(
            os.path.join(self.config["project_dir"], "dataflows/data_cache"),
            exist_ok=True,
        )

        # Initialize LLMs with provider-specific thinking configuration
        llm_kwargs = self._get_provider_kwargs()

        # Add API Key and callbacks if available
        if self.config.get("api_key"):
            llm_kwargs["api_key"] = self.config["api_key"]
        
        if self.callbacks:
            llm_kwargs["callbacks"] = self.callbacks

        deep_client = create_llm_client(
            provider=self.config["llm_provider"],
            model=self.config["deep_think_llm"],
            base_url=self.config.get("backend_url"),
            **llm_kwargs,
        )
        quick_client = create_llm_client(
            provider=self.config["llm_provider"],
            model=self.config["quick_think_llm"],
            base_url=self.config.get("backend_url"),
            **llm_kwargs,
        )

        self.deep_thinking_llm = deep_client.get_llm()
        self.quick_thinking_llm = quick_client.get_llm()

        # Initialize memories
        self.bull_memory = FinancialSituationMemory("bull_memory", self.config)
        self.bear_memory = FinancialSituationMemory("bear_memory", self.config)
        self.trader_memory = FinancialSituationMemory("trader_memory", self.config)
        self.invest_judge_memory = FinancialSituationMemory("invest_judge_memory", self.config)
        self.portfolio_manager_memory = FinancialSituationMemory("portfolio_manager_memory", self.config)

        # Create tool nodes
        self.tool_nodes = self._create_tool_nodes()

        # Initialize components
        self.conditional_logic = ConditionalLogic(
            max_debate_rounds=self.config["max_debate_rounds"],
            max_risk_discuss_rounds=self.config["max_risk_discuss_rounds"],
        )
        self.graph_setup = GraphSetup(
            self.quick_thinking_llm,
            self.deep_thinking_llm,
            self.tool_nodes,
            self.bull_memory,
            self.bear_memory,
            self.trader_memory,
            self.invest_judge_memory,
            self.portfolio_manager_memory,
            self.conditional_logic,
        )

        self.propagator = Propagator()
        self.reflector = Reflector(self.quick_thinking_llm)
        self.signal_processor = SignalProcessor(self.quick_thinking_llm)

        # State tracking
        self.curr_state = None
        self.ticker = None
        self.log_states_dict = {}  # date to full state dict

        # Set up the graph
        self.graph = self.graph_setup.setup_graph(selected_analysts)

    def _get_provider_kwargs(self) -> Dict[str, Any]:
        """Get provider-specific kwargs for LLM client creation."""
        kwargs = {}
        provider = self.config.get("llm_provider", "").lower()

        if provider == "google":
            thinking_level = self.config.get("google_thinking_level")
            if thinking_level:
                kwargs["thinking_level"] = thinking_level

        elif provider == "openai":
            reasoning_effort = self.config.get("openai_reasoning_effort")
            if reasoning_effort:
                kwargs["reasoning_effort"] = reasoning_effort

        elif provider == "anthropic":
            effort = self.config.get("anthropic_effort")
            if effort:
                kwargs["effort"] = effort

        return kwargs

    def _create_tool_nodes(self) -> Dict[str, ToolNode]:
        """Create tool nodes for different data sources using abstract methods."""
        return {
            "market": ToolNode(
                [
                    # Core stock data tools
                    get_stock_data,
                    # Technical indicators
                    get_indicators,
                ]
            ),
            "social": ToolNode(
                [
                    # News tools for social media analysis
                    get_news,
                ]
            ),
            "news": ToolNode(
                [
                    # News and insider information
                    get_news,
                    get_global_news,
                    get_insider_transactions,
                ]
            ),
            "fundamentals": ToolNode(
                [
                    # Fundamental analysis tools
                    get_fundamentals,
                    get_balance_sheet,
                    get_cashflow,
                    get_income_statement,
                ]
            ),
        }

    def _init_for_analysis(self):
        """Initialize agent status and report sections based on selected analysts.

        Matches CLI MessageBuffer.init_for_analysis() behavior.
        """
        self.agent_status = {}
        self.report_sections = {}
        self._last_message_id = None

        # Add selected analysts
        for analyst_key in self.selected_analysts:
            if analyst_key in self.ANALYST_AGENT_NAMES:
                self.agent_status[self.ANALYST_AGENT_NAMES[analyst_key]] = "pending"

        # Add fixed teams (Research, Trading, Risk Management)
        fixed_agents = [
            "Bull Researcher", "Bear Researcher", "Research Manager",
            "Trader",
            "Aggressive Analyst", "Neutral Analyst", "Conservative Analyst", "Portfolio Manager"
        ]
        for agent in fixed_agents:
            self.agent_status[agent] = "pending"

        # Build report_sections dynamically based on selected analysts
        for section, (analyst_key, _) in self.REPORT_SECTIONS.items():
            if analyst_key is None or analyst_key in self.selected_analysts:
                self.report_sections[section] = None

    def _update_agent_status(self, agent: str, status: str):
        """Update agent status and notify."""
        if agent in self.agent_status:
            self.agent_status[agent] = status

    def _update_report_section(self, section_name: str, content: str):
        """Update report section content."""
        if section_name in self.report_sections:
            self.report_sections[section_name] = content

    def _get_completed_reports_count(self) -> int:
        """Count reports that are finalized (their finalizing agent is completed).

        Matches CLI MessageBuffer.get_completed_reports_count() behavior.
        """
        count = 0
        for section in self.report_sections:
            if section not in self.REPORT_SECTIONS:
                continue
            _, finalizing_agent = self.REPORT_SECTIONS[section]
            has_content = self.report_sections.get(section) is not None
            agent_done = self.agent_status.get(finalizing_agent) == "completed"
            if has_content and agent_done:
                count += 1
        return count

    def _update_analyst_statuses(self, chunk: Dict[str, Any]):
        """Update analyst statuses based on accumulated report state.

        Matches CLI update_analyst_statuses() behavior:
        - Store new report content from the current chunk if present
        - Analysts with reports = completed
        - First analyst without report = in_progress
        - Remaining analysts without reports = pending
        - When all analysts done, set Bull Researcher to in_progress
        """
        found_active = False

        for analyst_key in self.ANALYST_ORDER:
            if analyst_key not in self.selected_analysts:
                continue

            agent_name = self.ANALYST_AGENT_NAMES[analyst_key]
            report_key = self.ANALYST_REPORT_MAP[analyst_key]

            # Capture new report content from current chunk
            if chunk.get(report_key):
                self._update_report_section(report_key, chunk[report_key])

            # Determine status from accumulated sections
            has_report = bool(self.report_sections.get(report_key))

            if has_report:
                self._update_agent_status(agent_name, "completed")
            elif not found_active:
                self._update_agent_status(agent_name, "in_progress")
                found_active = True
            else:
                self._update_agent_status(agent_name, "pending")

        # When all analysts complete, transition Bull Researcher to in_progress
        if not found_active and self.selected_analysts:
            if self.agent_status.get("Bull Researcher") == "pending":
                self._update_agent_status("Bull Researcher", "in_progress")

    def _update_research_team_status(self, status: str):
        """Update status for research team members (not Trader)."""
        research_team = ["Bull Researcher", "Bear Researcher", "Research Manager"]
        for agent in research_team:
            self._update_agent_status(agent, status)

    def _get_status_snapshot(self) -> Dict[str, Any]:
        """Get current status snapshot for SSE events."""
        snap: Dict[str, Any] = {
            "agent_status": dict(self.agent_status),
            "report_sections": {k: (v[:200] if v else None) for k, v in self.report_sections.items()},
            "completed_reports": self._get_completed_reports_count(),
            "total_reports": len(self.report_sections),
        }
        if self._stats_handler is not None:
            snap["stats"] = self._stats_handler.get_stats()
        return snap

    def _notify_progress(self, event_type: str, data: Dict[str, Any]):
        """Notify progress callback if available.

        Automatically includes status snapshot for state synchronization.
        """
        if self.progress_callback:
            try:
                # Add status snapshot to all events for state sync
                enriched_data = {**data, **self._get_status_snapshot()}

                if asyncio.iscoroutinefunction(self.progress_callback):
                    asyncio.run_coroutine_threadsafe(
                        self.progress_callback(event_type, enriched_data),
                        self.loop
                    )
                else:
                    self.progress_callback(event_type, enriched_data)
            except Exception as e:
                _log_graph.warning("Progress callback failed: %s", e, exc_info=True)

    def _notify_agent_start(self, agent_name: str, ticker: str):
        """Notify when an agent starts processing."""
        self._notify_progress("agent_start", {
            "agent": agent_name,
            "status": "running",
            "content": f"Starting {agent_name} analysis...",
            "ticker": ticker,
            "timestamp": time.time()
        })

    def _notify_agent_end(self, agent_name: str, ticker: str, result: str = None):
        """Notify when an agent completes processing."""
        self._notify_progress("agent_end", {
            "agent": agent_name,
            "status": "completed",
            "content": result or f"Completed {agent_name} analysis",
            "ticker": ticker,
            "timestamp": time.time()
        })

    def _notify_agent_error(self, agent_name: str, ticker: str, error: str):
        """Notify when an agent encounters an error."""
        self._notify_progress("agent_error", {
            "agent": agent_name,
            "status": "error",
            "content": f"Error in {agent_name}: {error}",
            "ticker": ticker,
            "timestamp": time.time()
        })

    def _notify_tool_call(self, tool_name: str, args: Dict[str, Any]):
        """Notify when a tool is called."""
        self._notify_progress("tool_call", {
            "tool": tool_name,
            "args": args,
            "timestamp": time.time()
        })

    def _notify_data_message(self, content: str):
        """Notify when data is retrieved."""
        self._notify_progress("data_message", {
            "content": content,
            "timestamp": time.time()
        })

    def _notify_control_message(self, content: str):
        """Notify when a control message (e.g. Continue) is issued."""
        self._notify_progress("control_message", {
            "content": content,
            "timestamp": time.time()
        })

    def _notify_report_update(self, section: str, content: str):
        """Notify when a report section is updated."""
        self._notify_progress("report_update", {
            "section": section,
            "content": content,
            "timestamp": time.time()
        })

    def cancel_task(self):
        """Cancel the current running task."""
        # Notify before cancellation
        self._notify_task_pre_cancel(self.ticker)

        self.cancel_requested = True
        self._notify_progress("task_cancelled", {
            "ticker": self.ticker,
            "timestamp": time.time()
        })

        # Notify after cancellation
        self._notify_task_post_cancel(self.ticker)


    def _notify_task_pre_cancel(self, ticker: str):
        """Notify before task cancellation."""
        self._notify_progress("task_pre_cancel", {
            "ticker": ticker,
            "timestamp": time.time()
        })

    def _notify_task_post_cancel(self, ticker: str):
        """Notify after task cancellation."""
        self._notify_progress("task_post_cancel", {
            "ticker": ticker,
            "timestamp": time.time()
        })

    def set_task_id(self, task_id: str):
        """Set the current task ID for tracking."""
        self.current_task_id = task_id

    def get_task_id(self) -> Optional[str]:
        """Get the current task ID."""
        return self.current_task_id

    def _extract_agent_name(self, state: Dict) -> Optional[str]:
        """Extract agent name from state based on current context."""
        # Check for analyst reports
        if "market_report" in state and state.get("market_report"):
            if state.get("sender") and "market" in state["sender"].lower():
                return "Market Analyst"
        if "sentiment_report" in state and state.get("sentiment_report"):
            if state.get("sender") and "social" in state["sender"].lower():
                return "Social Analyst"
        if "news_report" in state and state.get("news_report"):
            if state.get("sender") and "news" in state["sender"].lower():
                return "News Analyst"
        if "fundamentals_report" in state and state.get("fundamentals_report"):
            if state.get("sender") and "fundamental" in state["sender"].lower():
                return "Fundamentals Analyst"

        # Check for research team
        if state.get("sender") == "Bull Researcher":
            return "Bull Researcher"
        if state.get("sender") == "Bear Researcher":
            return "Bear Researcher"
        if state.get("sender") == "Research Manager":
            return "Research Manager"

        # Check for trader
        if state.get("sender") == "Trader":
            return "Trader"

        # Check for risk team
        if state.get("sender") == "Aggressive Analyst":
            return "Aggressive Analyst"
        if state.get("sender") == "Conservative Analyst":
            return "Conservative Analyst"
        if state.get("sender") == "Neutral Analyst":
            return "Neutral Analyst"
        if state.get("sender") == "Portfolio Manager":
            return "Portfolio Manager"

        return state.get("sender", "Unknown Agent")

    def _get_agent_status_content(self, state: Dict, agent_name: str) -> str:
        """Extract relevant content based on agent name."""
        if agent_name == "Market Analyst":
            return state.get("market_report", "")[:200] if state.get("market_report") else "Analyzing technical indicators..."
        elif agent_name == "Social Analyst":
            return state.get("sentiment_report", "")[:200] if state.get("sentiment_report") else "Analyzing social media sentiment..."
        elif agent_name == "News Analyst":
            return state.get("news_report", "")[:200] if state.get("news_report") else "Analyzing news and global events..."
        elif agent_name == "Fundamentals Analyst":
            return state.get("fundamentals_report", "")[:200] if state.get("fundamentals_report") else "Analyzing financial data..."
        elif "Researcher" in agent_name or "Manager" in agent_name:
            if agent_name == "Research Manager":
                return state.get("investment_plan", "")[:200] if state.get("investment_plan") else "Synthesizing research findings..."
            return "Debating investment thesis..."
        elif agent_name == "Trader":
            return state.get("trader_investment_plan", "")[:200] if state.get("trader_investment_plan") else "Formulating trading decision..."
        elif "Analyst" in agent_name or "Portfolio" in agent_name:
            return "Evaluating risk factors..."
        return "Processing..."

    def propagate(self, company_name, trade_date):
        """Run the trading agents graph for a company on a specific date.

        Uses CLI-consistent state management for agent status and report tracking.
        """

        config_token = set_config(self.config)
        try:
            self.ticker = company_name

            # Initialize state tracking (matches CLI MessageBuffer.init_for_analysis)
            self._init_for_analysis()

            # Initialize graph state
            init_agent_state = self.propagator.create_initial_state(
                company_name, trade_date
            )
            # Same as CLI: pass callbacks into graph.stream config so LangGraph/LCEL
            # propagates them to LLM and tool runs (constructor-only callbacks are not enough).
            args = self.propagator.get_graph_args(
                self.callbacks if self.callbacks else None
            )

            # Define the execution plan based on selected analysts
            plan = [
                {
                    "name": "Analyst Team",
                    "agents": [self.ANALYST_AGENT_NAMES.get(a, f"{a.capitalize()} Analyst")
                              for a in self.selected_analysts]
                },
                {
                    "name": "Research Team",
                    "agents": ["Bull Researcher", "Bear Researcher", "Research Manager"]
                },
                {
                    "name": "Trading Team",
                    "agents": ["Trader"]
                },
                {
                    "name": "Risk Management",
                    "agents": ["Aggressive Analyst", "Neutral Analyst", "Conservative Analyst", "Portfolio Manager"]
                }
            ]

            # Notify start with the execution plan
            self._notify_progress("task_start", {
                "ticker": company_name,
                "date": trade_date,
                "plan": plan,
                "timestamp": time.time()
            })

            # Initial preparation messages
            self._notify_progress("agent_progress", {
                "agent": "System",
                "content": f"Initializing multi-agent pipeline for {company_name}...",
                "timestamp": time.time()
            })

            self._notify_progress("agent_progress", {
                "agent": "System",
                "content": "Fetching historical market data and news...",
                "timestamp": time.time()
            })

            # Set first analyst to in_progress
            if self.selected_analysts:
                first_analyst = self.ANALYST_AGENT_NAMES.get(
                    self.selected_analysts[0],
                    f"{self.selected_analysts[0].capitalize()} Analyst"
                )
                self._update_agent_status(first_analyst, "in_progress")
                self._notify_agent_start(first_analyst, company_name)

            # Reset cancel flag for new task
            self.cancel_requested = False

            if self.debug:
                # Debug mode with tracing
                trace = []
                for chunk in self.graph.stream(init_agent_state, **args):
                    if len(chunk["messages"]) == 0:
                        pass
                    else:
                        chunk["messages"][-1].pretty_print()
                        trace.append(chunk)

                final_state = trace[-1]
            else:
                # Standard mode with CLI-consistent streaming
                final_state = None

                for chunk in self.graph.stream(init_agent_state, **args):
                    # Check if task was cancelled
                    if self.cancel_requested:
                        self._notify_progress("task_cancelled", {
                            "ticker": company_name,
                            "timestamp": time.time()
                        })
                        return None, "CANCELLED"

                    final_state = chunk

                    # Process messages (skip duplicates via message ID)
                    if "messages" in chunk and chunk["messages"]:
                        last_message = chunk["messages"][-1]
                        msg_id = getattr(last_message, "id", None)

                        if msg_id != self._last_message_id:
                            self._last_message_id = msg_id

                            # Handle tool calls from AI Assistant
                            if isinstance(last_message, AIMessage) and hasattr(last_message, "tool_calls") and last_message.tool_calls:
                                for tool_call in last_message.tool_calls:
                                    tool_name = tool_call.get("name", "unknown") if isinstance(tool_call, dict) else tool_call.name
                                    tool_args = tool_call.get("args", {}) if isinstance(tool_call, dict) else tool_call.args
                                    self._notify_tool_call(tool_name, tool_args)
                            
                            # Handle AI response content (thoughts/final answers)
                            elif isinstance(last_message, AIMessage):
                                content = str(last_message.content)
                                if content:
                                    agent_name = self._extract_agent_name(chunk)
                                    self._notify_progress("agent_thought", {
                                        "agent": agent_name,
                                        "content": content,
                                        "timestamp": time.time()
                                    })

                            # Handle data returned from tools
                            if isinstance(last_message, ToolMessage):
                                content = str(last_message.content)
                                if content and len(content) > 2000:
                                    content = content[:1997] + "..."
                                self._notify_data_message(content)

                            # Handle control messages (Human "Continue")
                            if isinstance(last_message, HumanMessage):
                                content = str(last_message.content) if last_message.content else ""
                                if content.strip() == "Continue":
                                    self._notify_control_message(content)

                    # Update analyst statuses based on report state (CLI-consistent)
                    self._update_analyst_statuses(chunk)

                    # Research Team - Handle Investment Debate State (CLI-consistent)
                    if chunk.get("investment_debate_state"):
                        debate_state = chunk["investment_debate_state"]
                        bull_hist = debate_state.get("bull_history", "").strip()
                        bear_hist = debate_state.get("bear_history", "").strip()
                        judge = debate_state.get("judge_decision", "").strip()

                        if bull_hist or bear_hist:
                            self._update_research_team_status("in_progress")

                        if bull_hist:
                            self._update_report_section(
                                "investment_plan", f"### Bull Researcher Analysis\n{bull_hist}"
                            )
                            self._notify_report_update("investment_plan", f"### Bull Researcher Analysis\n{bull_hist}")

                        if bear_hist:
                            self._update_report_section(
                                "investment_plan", f"### Bear Researcher Analysis\n{bear_hist}"
                            )
                            self._notify_report_update("investment_plan", f"### Bear Researcher Analysis\n{bear_hist}")

                        if judge:
                            self._update_report_section(
                                "investment_plan", f"### Research Manager Decision\n{judge}"
                            )
                            self._notify_report_update("investment_plan", f"### Research Manager Decision\n{judge}")
                            self._update_research_team_status("completed")
                            self._update_agent_status("Trader", "in_progress")
                            self._notify_agent_end("Research Manager", company_name, judge[:200])
                            self._notify_agent_start("Trader", company_name)

                    # Trading Team (CLI-consistent)
                    if chunk.get("trader_investment_plan"):
                        self._update_report_section("trader_investment_plan", chunk["trader_investment_plan"])
                        self._notify_report_update("trader_investment_plan", chunk["trader_investment_plan"])

                        if self.agent_status.get("Trader") != "completed":
                            self._update_agent_status("Trader", "completed")
                            self._update_agent_status("Aggressive Analyst", "in_progress")
                            self._notify_agent_end("Trader", company_name, chunk["trader_investment_plan"][:200])
                            self._notify_agent_start("Aggressive Analyst", company_name)

                    # Risk Management Team - Handle Risk Debate State (CLI-consistent)
                    if chunk.get("risk_debate_state"):
                        risk_state = chunk["risk_debate_state"]
                        agg_hist = risk_state.get("aggressive_history", "").strip()
                        con_hist = risk_state.get("conservative_history", "").strip()
                        neu_hist = risk_state.get("neutral_history", "").strip()
                        judge = risk_state.get("judge_decision", "").strip()

                        if agg_hist:
                            if self.agent_status.get("Aggressive Analyst") != "completed":
                                self._update_agent_status("Aggressive Analyst", "in_progress")
                            self._update_report_section(
                                "final_trade_decision", f"### Aggressive Analyst Analysis\n{agg_hist}"
                            )
                            self._notify_report_update("final_trade_decision", f"### Aggressive Analyst Analysis\n{agg_hist}")

                        if con_hist:
                            if self.agent_status.get("Conservative Analyst") != "completed":
                                self._update_agent_status("Conservative Analyst", "in_progress")
                            self._update_report_section(
                                "final_trade_decision", f"### Conservative Analyst Analysis\n{con_hist}"
                            )
                            self._notify_report_update("final_trade_decision", f"### Conservative Analyst Analysis\n{con_hist}")

                        if neu_hist:
                            if self.agent_status.get("Neutral Analyst") != "completed":
                                self._update_agent_status("Neutral Analyst", "in_progress")
                            self._update_report_section(
                                "final_trade_decision", f"### Neutral Analyst Analysis\n{neu_hist}"
                            )
                            self._notify_report_update("final_trade_decision", f"### Neutral Analyst Analysis\n{neu_hist}")

                        if judge:
                            if self.agent_status.get("Portfolio Manager") != "completed":
                                self._update_agent_status("Portfolio Manager", "in_progress")
                                self._update_report_section(
                                    "final_trade_decision", f"### Portfolio Manager Decision\n{judge}"
                                )
                                self._notify_report_update("final_trade_decision", f"### Portfolio Manager Decision\n{judge}")
                                # Mark all risk team as completed
                                self._update_agent_status("Aggressive Analyst", "completed")
                                self._update_agent_status("Conservative Analyst", "completed")
                                self._update_agent_status("Neutral Analyst", "completed")
                                self._update_agent_status("Portfolio Manager", "completed")
                                self._notify_agent_end("Portfolio Manager", company_name, judge[:200])

            # Final state fallback
            if final_state is None:
                final_state = init_agent_state

            # Update all agent statuses to completed
            for agent in self.agent_status:
                self._update_agent_status(agent, "completed")

            # Store current state for reflection
            self.curr_state = final_state

            # Log state
            self._log_state(trade_date, final_state)

            # Extract final decision (SSE/UI expect { decision, signal }, not a raw string)
            raw_fd = final_state.get("final_trade_decision", "") or ""
            decision_text = raw_fd if isinstance(raw_fd, str) else str(raw_fd)
            signal = self.process_signal(decision_text) or "neutral"

            self._notify_progress("task_complete", {
                "final_decision": {
                    "decision": decision_text,
                    "signal": signal,
                },
                "ticker": company_name,
                "date": trade_date,
                "timestamp": time.time(),
            })

            return final_state, signal
        finally:
            reset_config(config_token)


    async def propagate_async(self, company_name, trade_date):
        """Async version of propagate for running in async context."""
        # Create a task to run the propagate method
        task = asyncio.create_task(self._propagate_async_internal(company_name, trade_date))
        return await task

    async def _propagate_async_internal(self, company_name, trade_date):
        """Internal async implementation of propagate."""
        # This is where we would implement true async behavior
        # For now, we'll run the existing propagate method in a thread pool
        # to avoid blocking the event loop
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.propagate, company_name, trade_date)

    def _log_state(self, trade_date, final_state):
        """Log final state to a JSON file."""
        self.log_states_dict[str(trade_date)] = {
            "company_of_interest": final_state["company_of_interest"],
            "trade_date": final_state["trade_date"],
            "market_report": final_state["market_report"],
            "sentiment_report": final_state["sentiment_report"],
            "news_report": final_state["news_report"],
            "fundamentals_report": final_state["fundamentals_report"],
            "investment_debate_state": {
                "bull_history": final_state["investment_debate_state"]["bull_history"],
                "bear_history": final_state["investment_debate_state"]["bear_history"],
                "history": final_state["investment_debate_state"]["history"],
                "current_response": final_state["investment_debate_state"][
                    "current_response"
                ],
                "judge_decision": final_state["investment_debate_state"][
                    "judge_decision"
                ],
            },
            "trader_investment_decision": final_state["trader_investment_plan"],
            "risk_debate_state": {
                "aggressive_history": final_state["risk_debate_state"]["aggressive_history"],
                "conservative_history": final_state["risk_debate_state"]["conservative_history"],
                "neutral_history": final_state["risk_debate_state"]["neutral_history"],
                "history": final_state["risk_debate_state"]["history"],
                "judge_decision": final_state["risk_debate_state"]["judge_decision"],
            },
            "investment_plan": final_state["investment_plan"],
            "final_trade_decision": final_state["final_trade_decision"],
        }

        # Save to file
        directory = Path(self.config["results_dir"]) / self.ticker / "TradingAgentsStrategy_logs"
        directory.mkdir(parents=True, exist_ok=True)

        log_path = directory / f"full_states_log_{trade_date}.json"
        with open(log_path, "w", encoding="utf-8") as f:
            json.dump(self.log_states_dict[str(trade_date)], f, indent=4)

    def reflect_and_remember(self, returns_losses):
        """Reflect on decisions and update memory based on returns."""
        self.reflector.reflect_bull_researcher(
            self.curr_state, returns_losses, self.bull_memory
        )
        self.reflector.reflect_bear_researcher(
            self.curr_state, returns_losses, self.bear_memory
        )
        self.reflector.reflect_trader(
            self.curr_state, returns_losses, self.trader_memory
        )
        self.reflector.reflect_invest_judge(
            self.curr_state, returns_losses, self.invest_judge_memory
        )
        self.reflector.reflect_portfolio_manager(
            self.curr_state, returns_losses, self.portfolio_manager_memory
        )

    def process_signal(self, full_signal):
        """Process a signal to extract the core decision."""
        return self.signal_processor.process_signal(full_signal)
