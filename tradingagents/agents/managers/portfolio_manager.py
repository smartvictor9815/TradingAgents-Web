from tradingagents.agents.utils.agent_utils import build_instrument_context, get_language_instruction
from tradingagents.agents.utils.history_context import build_portfolio_manager_history


def create_portfolio_manager(llm, memory):
    def portfolio_manager_node(state) -> dict:

        instrument_context = build_instrument_context(state["company_of_interest"])

        history = state["risk_debate_state"]["history"]
        risk_debate_state = state["risk_debate_state"]
        market_research_report = state["market_report"]
        news_report = state["news_report"]
        fundamentals_report = state["fundamentals_report"]
        sentiment_report = state["sentiment_report"]
        research_plan = state["investment_plan"]
        trader_plan = state["trader_investment_plan"]

        curr_situation = f"{market_research_report}\n\n{sentiment_report}\n\n{news_report}\n\n{fundamentals_report}"
        past_memories = memory.get_memories(curr_situation, n_matches=2)

        past_memory_str = ""
        for i, rec in enumerate(past_memories, 1):
            past_memory_str += rec["recommendation"] + "\n\n"

        pm_history = build_portfolio_manager_history(state["company_of_interest"])
        history_block = f"\n- Prior analyses for this ticker:\n{pm_history}" if pm_history else ""

        prompt = f"""As the Portfolio Manager, synthesize the risk analysts' debate and deliver the final trading decision.

{instrument_context}

---

**Rating Scale** (use exactly one):
- **Buy**: Strong conviction to enter or add to position
- **Overweight**: Favorable outlook, gradually increase exposure
- **Hold**: Maintain current position, no action needed
- **Underweight**: Reduce exposure, take partial profits
- **Sell**: Exit position or avoid entry

**Context:**
- Research Manager's investment plan: **{research_plan}**
- Trader's transaction proposal: **{trader_plan}**
- Lessons from past decisions: **{past_memory_str}**{history_block}
- Analyst reports (market / sentiment / news / fundamentals) include a `## Confidence`
  block with `confidence_score` hints. Use those hints as priors, then calibrate by
  cross-checking consistency, evidence quality, and conflict severity.
- If prior analyses for this ticker are available, compare the current situation with past
  assessments. Note trend changes, whether prior recommendations were consistent, and
  whether new data significantly shifts the outlook.

**Required Output Format (STRICT JSON ONLY, no extra text):**
{{
  "rating": "Buy | Overweight | Hold | Underweight | Sell",
  "executive_summary": "A concise action plan covering entry, sizing, risk levels, and horizon.",
  "investment_thesis": "Detailed reasoning anchored in debate evidence and past reflections.",
  "dimension_confidence": {{
    "market": 0-100,
    "sentiment": 0-100,
    "news": 0-100,
    "fundamentals": 0-100,
    "research": 0-100,
    "risk": 0-100
  }}
}}

Rules:
- `dimension_confidence` values must be integers between 0 and 100.
- Use all six keys exactly as listed.
- Keep JSON valid and parseable by `json.loads`.
- Do not wrap JSON in markdown code fences.
- For market/sentiment/news/fundamentals: start from analyst confidence hints and adjust
  up/down based on evidence strength and contradictions.
- For research/risk: infer from debate quality, argument consistency, and risk controls.

---

**Risk Analysts Debate History:**
{history}

---

Be decisive and ground every conclusion in specific evidence from the analysts.{get_language_instruction()}"""

        response = llm.invoke(prompt)

        new_risk_debate_state = {
            "judge_decision": response.content,
            "history": risk_debate_state["history"],
            "aggressive_history": risk_debate_state["aggressive_history"],
            "conservative_history": risk_debate_state["conservative_history"],
            "neutral_history": risk_debate_state["neutral_history"],
            "latest_speaker": "Judge",
            "current_aggressive_response": risk_debate_state["current_aggressive_response"],
            "current_conservative_response": risk_debate_state["current_conservative_response"],
            "current_neutral_response": risk_debate_state["current_neutral_response"],
            "count": risk_debate_state["count"],
        }

        return {
            "risk_debate_state": new_risk_debate_state,
            "final_trade_decision": response.content,
        }

    return portfolio_manager_node
