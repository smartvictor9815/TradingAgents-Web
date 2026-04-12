import contextvars
from typing import Dict, Optional

import tradingagents.default_config as default_config

# Base fallback config (never mutated)
_BASE_CONFIG: Dict = default_config.DEFAULT_CONFIG.copy()

# Request/task-local runtime config
_CONFIG_CONTEXT: contextvars.ContextVar[Optional[Dict]] = contextvars.ContextVar(
    "tradingagents_runtime_config",
    default=None,
)


def initialize_config():
    """Compatibility no-op for legacy callers."""
    return None


def set_config(config: Dict) -> contextvars.Token:
    """Set task-local config, merged on top of current effective config."""
    merged = get_config()
    merged.update(config)
    return _CONFIG_CONTEXT.set(merged)


def reset_config(token: contextvars.Token):
    """Restore previous task-local config state."""
    _CONFIG_CONTEXT.reset(token)


def get_config() -> Dict:
    """Get the current effective configuration for this execution context."""
    current = _CONFIG_CONTEXT.get()
    if current is None:
        return _BASE_CONFIG.copy()
    return current.copy()


# Keep legacy module side-effect for compatibility
initialize_config()
