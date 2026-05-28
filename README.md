# 法律诉求＋证据整理Agent

**当前版本：v2.0-evidence-model**  
**当前分支：v2.0**  
**状态：尚未接入 RAG**  
**版本定位：律师思考模型版证据整理 Agent**

## 项目简介

本项目是一个面向婚姻家事场景的法律诉求与证据整理 Agent。

它的目标不是替代律师提供正式法律意见，而是帮助用户完成初步事实整理、诉求识别、证据准备和律师沟通前的信息结构化。

当前 v2.0 版本重点升级了证据整理逻辑：
从简单证据清单生成，升级为按照"用户诉求 → 法律关系 → 法律要件 → 待证事实 → 核心证据 / 辅助证据"的律师思考路径生成证据清单。

## v2.0 改进与优化

- 前端主流程稳定：用户输入案情 → 诉求识别 → 用户确认诉求 → 生成证据清单。
- 诉求卡片由用户手动确认，避免系统自动替用户决定诉求。
- Evidence App 输出结构升级为律师思考模型：
  - 法律关系分析
  - 法律要件分析
  - 待证事实拆解
  - 核心证据整理
  - 辅助证据整理
  - 缺失信息提示
- 证据清单从泛泛罗列升级为"证据 → 证明目的 → 对应待证事实 → 关联诉求"的结构化展示。
- 前端支持核心证据和辅助证据分区展示。
- 每条证据支持"已准备"勾选，方便用户自查证据准备进度。
- 保留诉求识别与证据整理的分步流程，降低误判风险。
- 当前版本尚未接入 RAG，后续 v2.1 计划接入婚姻家事证据规则知识库。

## 核心流程

```
用户输入自然语言案情
→ 诉求识别（Intent Discovery App）
→ 用户手动确认诉求
→ 证据清单生成（Analysis/Evidence App）
→ 按律师思考模型输出：法律关系 → 法律要件 → 待证事实 → 核心证据 / 辅助证据
```

## 技术栈

- **React** — 前端框架
- **TypeScript** — 类型安全
- **Vite** — 构建工具
- **Tailwind CSS** — 样式方案
- **Dify Workflow** — AI 工作流引擎
- 前端通过 Vite proxy 调用 Dify API 实现诉求识别与证据整理

## Dify 双 App 架构

### Intent Discovery App（诉求识别）

- 判断用户信息是否充分
- 信息不足时生成追问问题
- 信息充分时识别 `possible_claims`

### Analysis/Evidence App（证据整理）

- 接收用户确认后的 `confirmed_claims`
- 按律师思考模型生成结构化输出：
  - `case_type` — 案件类型
  - `legal_analysis` — 法律关系分析（含法律要件、待证事实）
  - `evidence_list.core_evidence` — 核心证据
  - `evidence_list.supporting_evidence` — 辅助证据
  - `missing_information` — 仍需补充的信息

## 本地运行

### 1. 克隆仓库

```bash
git clone https://github.com/SuKi-you/legal-claim-evidence-agent.git
cd legal-claim-evidence-agent
```

### 2. 切换到 v2.0 分支

```bash
git checkout v2.0
```

### 3. 安装依赖

```bash
npm install
```

### 4. 配置环境变量

项目不提交真实 API Key。请根据 `.env.example` 在本地创建 `.env` 文件：

```bash
cp .env.example .env
```

然后编辑 `.env`，填写自己的 Dify API 地址和 API Key：

```env
DIFY_API_BASE_URL=http://localhost/v1
DIFY_INTENT_API_KEY=你的 Intent Discovery App API Key
DIFY_ANALYSIS_API_KEY=你的 Analysis/Evidence App API Key
```

> **注意：**
> - `.env` 只用于本地运行
> - `.env` 不应提交到 GitHub（已在 `.gitignore` 中排除）
> - 不要把真实 API Key 写入 README、源码或提交记录

### 5. 导入 Dify 工作流

在 Dify 中导入 `dify-workflows` 目录下的工作流文件：

- `intent-discovery-app.yml` — 诉求识别工作流
- `analysis-evidence-app.yml` — 证据整理工作流

然后在 Dify 中：
1. 配置模型供应商和 API Key
2. 获取两个 App 的 API Key
3. 填入 `.env` 文件
4. 确保工作流已发布

### 6. 启动开发服务器

```bash
npm run dev
```

打开浏览器访问终端输出的本地地址，通常是：

```
http://localhost:5173
```

### 7. 排查问题

如果页面无法正常调用 Dify，请检查：

- `.env` 文件是否存在且配置正确
- Dify API Key 是否填写正确（与 Dify 后台一致）
- Dify Workflow 是否已发布
- 前端环境变量名称是否与代码读取的名称一致
- 浏览器控制台（DevTools → Console）是否有请求错误
- Vite 终端输出中是否有 `[dify-proxy]` 相关日志

## 测试用例

### MM01 — 基础离婚场景

**输入：**
```
我受不了了，我想离婚
```

**预期：** 系统不应直接生成证据清单，应先追问关键信息。

### MM03 — 信息充分场景

**输入：**
```
我和对方结婚5年，有一个3岁的女儿，房子是婚后买的，对方长期不回家，我现在想离婚并争取孩子抚养权。
```

**预期：** 系统先展示可能诉求卡片（离婚、子女抚养权、财产分割/房产处理、抚养费等），用户手动确认后生成证据清单。

### MM05 — 复杂多诉求场景

**输入：**
```
我想离婚，他长期不回家，还出轨，给别人转钱。我们有一个孩子，孩子现在跟我生活，婚后还有一套房。
```

**预期：** 诉求卡片包含离婚、子女抚养权、抚养费、财产分割/房产处理、财产转移、出轨/婚内过错、离婚损害赔偿。证据清单分核心证据和辅助证据展示。

## 版本规划

- **v1.0** — 基础法律诉求识别与证据清单生成。
- **v2.0-evidence-model** — 律师思考模型版证据整理，尚未接入 RAG（当前版本）。
- **v2.1-rag-mvp** — 计划接入婚姻家事证据规则 RAG 知识库。

## 安全说明

- 本项目不会在仓库中保存真实 API Key。
- 请使用 `.env` 在本地配置密钥，`.env` 已通过 `.gitignore` 排除提交。
- 不要提交 `.env`、`.env.*`、`node_modules`、`dist`、`build` 或任何包含密钥的文件。
- Dify workflow 导出文件如果包含敏感信息，应先脱敏后再提交。
- 如果怀疑已意外提交了密钥，请立即在 Dify 后台轮换 API Key，并使用 `git filter-branch` 或 `BFG Repo-Cleaner` 清理历史。

## 免责声明

本项目仅用于法律信息整理、AI Agent 产品设计展示和学习交流，不构成正式法律意见。

如需处理真实案件，请咨询专业律师。
