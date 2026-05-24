# TradingAgents-Web 功能说明（用户视角）

本文面向普通使用者，介绍如何在网页端完成一次分析、查看历史、导出报告以及查看统计信息。  
配图来自 `assets/web/` 目录。

---

## 页面截图总览

### Analysis
![Analysis 页面](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/Analysis.png)

### Providers
![Provider 页面](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/Provider.png)

### Settings
![Settings 页面](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/Setting.png)

### History 列表
![History 列表页](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/History_main.png)

### History 详情
![History 详情页](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/History_detail.png)

### Statistics
![Statistics 页面](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/Statistics.png)

---

## 1. Analysis（开始分析）

![Analysis 页面](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/Analysis.png)

你在这个页面主要完成三件事：

- 输入股票代码（Ticker）和分析日期
- 点击开始分析，观察实时日志和进度
- 查看最终建议与各维度置信度

### 你会看到什么

- **实时日志区**：显示多智能体分析过程（Agent / Tool / Data / System）
- **团队进度区**：可以看到 Analyst、Research、Trader、Risk、Portfolio 等阶段的执行状态
- **结果区**：分析完成后展示最终建议（如 BUY / SELL / HOLD）和理由
- **Confidence Radar**：按维度展示模型置信度，帮助你判断建议可靠性

### 常用操作

- **Start Analysis**：发起新的分析任务
- **Stop**：中止当前分析
- **Export**：导出当前任务报告（Markdown / PDF / DOCX）

---

## 2. Providers（配置模型提供商）

![Provider 页面](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/Provider.png)

这个页面用于管理你可用的 LLM 提供商配置，比如 OpenAI / OpenRouter / DeepSeek 等。

### 你可以做什么

- 新增一个 Provider（名称、Base URL、模型、API Key）
- 测试连接是否正常
- 设置默认 Provider
- 编辑或删除旧配置

### 使用建议

- 先点 **Test**，确认密钥和地址可用，再用于正式分析
- 区分 **Quick Think** 与 **Deep Think** 模型，兼顾速度与质量

---

## 3. Settings（分析策略设置）

![Settings 页面](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/Setting.png)

这个页面决定“分析怎么跑”，包括语言、分析师组合、研究深度等。

### 典型设置项

- **输出语言**：例如中文或英文
- **分析师选择**：市场、新闻、社媒、基本面等维度
- **研究深度**：浅层/深层（通常深层更慢但更细）
- **数据源参数**：与行情/数据服务相关的配置

### 对结果的影响

- 分析师选得越多，覆盖面更广，但耗时通常更长
- 研究深度越高，报告细节更多，token 消耗也更高

---

## 4. History（历史记录与复盘）

### 4.1 历史列表页

![History 列表页](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/History_main.webp)

在这里你可以管理过去跑过的任务。

- 查看任务状态（completed / running / failed）
- 按条目打开历史详情
- 删除不需要的历史记录
- 从历史任务再次导出报告

### 4.2 历史详情页

![History 详情页](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/History_detail.png)

详情页适合复盘一次完整分析：

- 查看最终建议与完整理由
- 查看各维度置信度图
- 对照日志理解“为什么得到这个结论”

---

## 5. Statistics（统计面板）

![Statistics 页面](https://raw.githubusercontent.com/smartvictor9815/TradingAgents-Web/main/assets/web/Statistics.png)

这个页面帮助你从“长期使用”的角度看系统表现。

### 你可以关注的指标

- 调用量（LLM Calls / Tool Calls）
- Token 消耗（输入/输出）
- 不同 Provider 的使用占比
- 历史任务数量与成功情况

### 适用场景

- 控制成本：评估哪个模型最省 token
- 优化体验：平衡“分析质量”和“速度”
- 运营复盘：观察一段时间内的整体使用趋势

---

## 6. 一次标准使用流程（建议）

1. 先在 **Providers** 配好模型并测试通过  
2. 在 **Settings** 选择语言、分析师和研究深度  
3. 回到 **Analysis** 输入 Ticker 启动任务  
4. 在日志中观察进度，等待最终建议  
5. 去 **History** 复盘并导出报告  
6. 到 **Statistics** 看整体成本和效果

---

## 7. 注意事项（用户角度）

- 本系统输出仅供研究参考，不构成投资建议
- 建议对关键结论做二次验证（财报、公告、行情数据）
- 深度分析通常更耗时，请根据场景选择合适配置

