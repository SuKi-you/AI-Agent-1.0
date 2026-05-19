# AI 法律诉求分析 Agent

一个面向婚姻家事/离婚纠纷场景的 AI 法律诉求分析 Demo。

用户输入自然语言案情后，系统会先判断信息是否充分；如果信息不足，会主动追问；如果信息充分，会整理出所有可能诉求；用户筛选诉求后，系统生成结构化分析、风险提示以及所需准备的证据。

## 项目解决的问题

很多当事人在咨询离婚案件时，表达往往情绪化、碎片化，不知道自己的专业法律诉求是什么。经验少的律师听当事人疯狂"输出"之后也是一头雾水。

本项目尝试通过 AI Agent 帮助用户从自然语言中梳理可能诉求，并引导用户补充关键信息，提醒用户可能需要准备哪些证据。

**帮用户省钱！帮律师省心！**

## 核心流程

```
用户输入自然语言
→ 信息充分性判断
→ 信息不足则追问
→ 信息充分则发现可能诉求
→ 用户确认诉求
→ 生成分析结果、证据清单和风险提示
```

## 技术栈

- **Vite** — 构建工具
- **React** — 前端框架
- **Tailwind CSS** — 样式方案
- **Dify** — AI 工作流引擎
- **Docker** — Dify 本地部署
- **Claude Code** — 辅助开发

## Dify 双 App 架构

### Intent Discovery App

- 判断用户信息是否充分
- 信息不足时生成追问问题
- 信息充分时识别 `possible_claims`

### Analysis/Evidence App

- 接收用户确认后的 `confirmed_claims`
- 进行结构化法律诉求分析
- 生成证据清单、缺失信息和风险提示

## 本地运行步骤

### 第一步：启动本地 Docker Dify

确保 Docker 已安装并运行，然后启动 Dify。

### 第二步：导入 Dify 工作流

在 Dify 中导入 `dify-workflows` 目录下的两个 yml 文件：

- `intent-discovery-app.yml`
- `analysis-evidence-app.yml`

### 第三步：配置模型供应商

在 Dify 中配置自己的模型供应商和模型 API Key。

### 第四步：获取 API Key

获取两个 Dify App 的 API Key。

### 第五步：配置环境变量

```bash
cp .env.example .env
```

### 第六步：填写 .env

```env
DIFY_API_BASE_URL=http://localhost/v1
DIFY_INTENT_API_KEY=自己的 Intent Discovery App API Key
DIFY_ANALYSIS_API_KEY=自己的 Analysis/Evidence App API Key
```

### 第七步：安装依赖

```bash
npm install
```

### 第八步：启动项目

```bash
npm run dev
```

浏览器打开 `http://localhost:5173` 即可体验。

## 测试用例

### 测试 1

**输入：**
```
我受不了了，我想离婚
```

**预期结果：**
系统不应直接生成证据清单，而应先追问关键信息。

### 测试 2

**输入：**
```
我和对方结婚5年，有一个3岁的女儿，房子是婚后买的，对方长期不回家，我现在想离婚并争取孩子抚养权。
```

**预期结果：**
系统应先展示可能诉求选择 UI，例如离婚、子女抚养权、财产分割、抚养费等。

### 测试 3

用户确认诉求后，系统才生成案件分析、证据清单和风险提示。

## 免责声明

本项目仅用于法律信息整理、AI Agent 产品设计展示和学习交流，不构成正式法律意见。

如需处理真实案件，请咨询专业律师。
