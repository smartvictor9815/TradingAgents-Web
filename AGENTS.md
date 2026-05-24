## Cursor Cloud specific instructions

### Project overview

TradingAgents-Web is a FastAPI backend + Vite/React frontend for multi-agent LLM financial analysis. SQLite is embedded (no external DB). An LLM provider API key is required only for running actual analyses, not for starting services or running tests.

### Services

| Service | Command (from repo root) | Port |
|---|---|---|
| Backend API | `python3 -m uvicorn app.api.main:app --host 127.0.0.1 --port 18000` | 18000 |
| Frontend dev | `cd frontend && npm run dev` | 3000 |

Both can be started together: `bash scripts/start_services.sh`

### Lint / Test / Build

See `README.md` **Development** section. Quick reference:

- **Frontend lint**: `cd frontend && npm run lint`
- **Frontend build**: `cd frontend && npm run build` (runs `tsc` then Vite)
- **Python syntax check**: `python3 -m compileall -q app tradingagents`
- **Tests**: `PYTHONPATH=. python3 -m pytest tests/ -v`

CI (`.github/workflows/ci.yml`) runs frontend lint+build and Python compileall.

### Known gotchas

- `pytest` binary may not be on `$PATH` after `pip install -e ".[dev]"` in the system Python; use `python3 -m pytest` instead.
- One test (`test_delete_cancel_invokes_graph_cancel_and_propagate_exits_early`) has a pre-existing race condition where the mock task completes before the cancel request arrives; this is not caused by environment issues.
- The frontend Vite dev server proxies `/api` to `127.0.0.1:18000`. Start the backend first or the proxy will return 502.
- `.env` must exist at the repo root for the backend to load provider API keys. Copy from `.env.example` if missing.
- The default LLM provider in `tradingagents/default_config.py` is `openai`. To use DeepSeek, change the provider in the UI Settings page to "DeepSeek". The UI Settings stores provider selection in browser localStorage.
- When starting the backend, pass the API key env var explicitly if it's not in `.env`: e.g. `DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY python3 -m uvicorn app.api.main:app --host 127.0.0.1 --port 18000`
