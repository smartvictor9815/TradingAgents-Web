# TradingAgents-Web Feature Guide (User Perspective)

This guide explains how to use the web UI from an end-user perspective: start analysis, review history, export reports, and monitor usage statistics.  
Screenshots are referenced from `assets/web/`.

---

## Screenshot Overview

### Analysis
![Analysis page](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/Analysis.png)

### Providers
![Providers page](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/Provider.png)

### Settings
![Settings page](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/Setting.png)

### History list
![History list](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/History_main.png)

### History detail
![History detail](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/History_detail.png)

### Statistics
![Statistics page](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/Statistics.png)

---

## 1. Analysis (Run a New Analysis)

![Analysis page](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/Analysis.png)

On this page, you mainly do three things:

- Enter a stock ticker and analysis date
- Start analysis and watch live logs/progress
- Review the final recommendation and confidence dimensions

### What you will see

- **Live log panel**: multi-agent trace output (Agent / Tool / Data / System)
- **Team progress panel**: execution status across Analyst, Research, Trader, Risk, and Portfolio stages
- **Result panel**: final action (BUY / SELL / HOLD) and explanation
- **Confidence Radar**: per-dimension confidence to help evaluate recommendation reliability

### Common actions

- **Start Analysis**: launch a new task
- **Stop**: cancel the current run
- **Export**: download task output as Markdown / PDF / DOCX

---

## 2. Providers (Manage LLM Providers)

![Providers page](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/Provider.png)

Use this page to manage provider configs such as OpenAI / OpenRouter / DeepSeek.

### What you can do

- Add a provider (name, base URL, models, API key)
- Test connectivity
- Set default provider
- Edit or remove existing entries

### Recommended workflow

- Use **Test** first to verify key and endpoint
- Separate **Quick Think** and **Deep Think** models for speed/quality balance

---

## 3. Settings (Control Analysis Strategy)

![Settings page](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/Setting.png)

This page defines how analysis runs, including language, analyst set, and research depth.

### Typical options

- **Output language**
- **Analyst selection** (market, news, social, fundamentals, etc.)
- **Research depth** (shallow/deep)
- **Data vendor settings**

### Practical impact

- More analysts usually means wider coverage but longer runtime
- Deeper research usually gives richer detail but higher token usage

---

## 4. History (Review Past Runs)

### 4.1 History list

![History list](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/History_main.webp)

Use this page to manage previous tasks:

- Check status (completed / running / failed)
- Open a task for details
- Delete old entries
- Re-export reports from historical tasks

### 4.2 History detail

![History detail](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/History_detail.png)

The detail view is designed for full post-run review:

- Final recommendation and full rationale
- Confidence radar by dimension
- Trace logs for “why this conclusion was made”

---

## 5. Statistics (Usage and Cost Visibility)

![Statistics page](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/Statistics.png)

This page helps you evaluate longer-term usage and performance.

### Key metrics

- LLM calls and tool calls
- Input/output token usage
- Provider-level usage breakdown
- Historical task volume and outcomes

### Typical use cases

- Cost control (which model profile is more efficient)
- Quality/speed tuning (trade-off optimization)
- Operational review over time

---

## 6. Suggested Standard Workflow

1. Configure providers in **Providers** and pass connectivity tests  
2. Set language, analysts, and depth in **Settings**  
3. Start a task from **Analysis**  
4. Watch logs and wait for final recommendation  
5. Use **History** for review and export  
6. Check **Statistics** for cost and usage trend

---

## 7. Notes

- Outputs are for research use only, not investment advice
- Validate important conclusions against primary sources (filings, announcements, market data)
- Deep runs take longer; choose settings based on your scenario

