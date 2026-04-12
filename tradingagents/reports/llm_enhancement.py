"""Optional LLM pass to produce a shorter polished summary for exports."""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

from langchain_core.messages import HumanMessage

from tradingagents.llm_clients.factory import create_llm_client

_PROVIDER_ENV_KEYS: Dict[str, str] = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "google": "GOOGLE_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "volcengine": "VOLCENGINE_API_KEY",
    "xai": "XAI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "ollama": "OLLAMA_API_KEY",  # usually unused; client defaults to "ollama"
}


def _resolve_api_key(provider: str, runtime_config: Dict[str, Any]) -> Optional[str]:
    raw = runtime_config.get("api_key")
    if isinstance(raw, str) and raw and raw != "***" and not raw.startswith("***"):
        return raw
    env_name = _PROVIDER_ENV_KEYS.get(provider.lower(), "OPENAI_API_KEY")
    return os.environ.get(env_name)


def generate_llm_enhancement(
    *,
    agent_outputs_markdown: str,
    output_language: str,
    ticker: str,
    analysis_date: str,
    final_decision: Optional[Dict[str, Any]],
    runtime_config: Dict[str, Any],
) -> str:
    """
    Call the configured quick-thinking model to write an executive-style summary.

    Persisted ``runtime_config`` often redacts ``api_key``; environment variables are used then.
    """
    provider = str(runtime_config.get("llm_provider") or "openai").lower().strip()
    model = (
        runtime_config.get("quick_think_llm")
        or runtime_config.get("deep_think_llm")
        or "gpt-4o-mini"
    )
    base_url = runtime_config.get("backend_url")
    api_key = _resolve_api_key(provider, runtime_config)

    kwargs: Dict[str, Any] = {}
    if api_key:
        kwargs["api_key"] = api_key
    elif provider == "ollama":
        kwargs["api_key"] = "ollama"
    else:
        raise RuntimeError(
            "No API key for LLM enhancement: stored report config redacts keys; set e.g. OPENAI_API_KEY "
            "in the server environment, or use a provider that reads keys from env."
        )

    client = create_llm_client(provider, str(model), base_url=base_url, **kwargs)
    llm = client.get_llm()

    lang = (output_language or "english").strip()
    fd_bits = ""
    if isinstance(final_decision, dict):
        fd_bits = "\n".join(
            f"- {k}: {v}"
            for k, v in final_decision.items()
            if v is not None and k in ("decision", "signal", "reasoning")
        )

    prompt = f"""You are an editor. Given the following multi-agent equity research Markdown for ticker {ticker} as of {analysis_date}, write a concise executive summary in {lang}.

Focus on: thesis, key risks, and a clear action-style takeaway (still not personalized investment advice).

Structured decision fields (if any):
{fd_bits or "(none)"}

--- Source Markdown ---
{agent_outputs_markdown[:120000]}
--- End ---

Respond with Markdown only (no preamble). Use ## Executive summary as the first heading."""

    resp = llm.invoke([HumanMessage(content=prompt)])
    text = getattr(resp, "content", None) or str(resp)
    if isinstance(text, list):
        text = "\n".join(str(x) for x in text)
    return str(text).strip()
