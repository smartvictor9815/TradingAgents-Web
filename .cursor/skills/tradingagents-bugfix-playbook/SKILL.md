---
name: tradingagents-bugfix-playbook
description: Fixes recurrent TradingAgents-Web bugs across FastAPI, React, SSE logs, report export, timer restore, route rename, and docs rendering. Use when the user reports regressions, UI/backend mismatch, resume-state bugs, export failures, or asks to stabilize/start-stop the app.
---
# TradingAgents Bugfix Playbook

## When to use

Apply this skill when user issues include:

- analysis page resume/log display mismatch
- timer resets after page switch
- `reports`/`history` route or API inconsistency
- PDF/DOCX export failure or degraded formatting
- service start/stop instability
- docs screenshot rendering broken

## Fast triage workflow

1. Reproduce from user path first (do not assume root cause).
2. Identify one source of truth per layer:
   - frontend state: `frontend/src/hooks/useAnalysis.ts`
   - frontend screen: `frontend/src/components/AnalysisPage.tsx`
   - API status/events: `app/api/main.py`
   - persisted history/messages: `app/api/report_store.py`
3. Prefer compatibility-first fixes:
   - add aliases/redirects before deleting old paths
   - keep old API names as temporary exports where possible
4. Validate both static and runtime behavior before finishing.

## Known bug patterns and proven fixes

### 1) Resume returns placeholder log only

**Symptom**
- Returning to Analysis shows a generic system line instead of full history.

**Fix pattern**
- Backend `/api/task/{id}` should return `messages` derived from event history (or persisted report fallback).
- Frontend resume should prioritize stored/history messages and avoid synthetic placeholder for completed tasks.

**Files**
- `app/api/main.py`
- `app/api/report_store.py`
- `frontend/src/hooks/useAnalysis.ts`

### 2) Timer resets on page switch

**Symptom**
- `Analyzing Performance` time restarts when returning to Analysis page.

**Fix pattern**
- Use task timestamps (`started_at`, `completed_at`) as canonical start/end.
- Add robust parser for Python `isoformat` timestamps.
- Keep `startTime`/`endTime` in state; display elapsed from canonical values.

**Files**
- `frontend/src/hooks/useAnalysis.ts`
- `frontend/src/components/AnalysisPage.tsx`

### 3) `reports` vs `history` naming drift

**Symptom**
- Menu and route labels differ from backend/API paths or old bookmarks break.

**Fix pattern**
- Standardize UX wording to `History`.
- Add route redirect (`/reports -> /history`) and API aliases (`/api/reports` and `/api/history`) during transition.
- Keep temporary frontend function aliases to reduce breakage.

**Files**
- `frontend/src/components/MainLayout.tsx`
- `frontend/src/routes.tsx`
- `frontend/src/api/client.ts`
- `app/api/main.py`

### 4) PDF export fails or looks like raw markdown

**Symptom**
- Export errors mention missing `xhtml2pdf`/font issues; or PDF renders plain markdown.

**Fix pattern**
- Keep `xhtml2pdf` optional; fallback to `fpdf2` HTML rendering path.
- Log backend exceptions explicitly for diagnosis.
- Ensure font fallback handles italic/bold variants.

**Files**
- `tradingagents/reports/export_formats.py`

### 5) DOCX export contains raw markdown

**Symptom**
- Word report not structured (headings/list/table/code lost).

**Fix pattern**
- Convert markdown to HTML, then map tags to `python-docx` document elements.

**Files**
- `tradingagents/reports/export_formats.py`

### 6) Markdown screenshots not rendering

**Symptom**
- Feature docs images do not appear in editor preview.

**Fix pattern**
- Prefer absolute GitHub raw URLs if relative path rendering is inconsistent in target viewer.
- Keep image filenames case-exact.

**Files**
- `docs/WEB_FEATURE_GUIDE_EN.md`
- `docs/WEB_FEATURE_GUIDE_ZH.md`

## Service reliability ops

Use project scripts for deterministic lifecycle:

- install: `bash scripts/install.sh`
- start: `bash scripts/start_services.sh`
- stop: `bash scripts/stop_services.sh`
- status: `bash scripts/status_services.sh`

If services were started manually before scripts existed, stop legacy processes once, then switch to script-managed lifecycle.

## Validation checklist (must run after substantive fixes)

### Frontend
- `npm run build` (in `frontend/`)
- check changed pages manually if runtime behavior was affected

### Backend
- `python -m py_compile app/api/main.py app/api/report_store.py`
- restart backend if API behavior changed

### Quality
- run lints for changed files (`ReadLints`)
- verify no placeholder-only regressions in resume logs/timer/history

## Response style for bugfix updates

When reporting completion:

1. state user-visible behavior change first
2. list touched files by responsibility
3. include verification commands and outcome
4. call out compatibility behavior kept intentionally
