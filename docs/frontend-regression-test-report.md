# Frontend Regression Test Report

## 测试信息

| 字段 | 值 |
|---|---|
| 测试日期 | 2026-05-21 |
| 测试环境 | Windows 11, Vite v7.3.1, React 19, TypeScript |
| 测试版本 | master branch |
| 测试方法 | 静态代码路径分析（非浏览器点击测试） |
| 分析范围 | src/App.tsx (~2100 行)、vite.config.ts |
| Skills | legal-claim-agent-ux, react-state-machine, typescript-data-safety |

## 重要说明

**本报告当前主要基于代码静态分析，涉及 Dify 实际返回、浏览器点击、UI 视觉状态的用例仍需人工或自动化浏览器测试验证。**

本次测试为代码路径静态分析，未在真实浏览器中执行点击测试。每个用例的分析基于：
- 逐行追踪 `handleSubmit` 函数的路由分支
- 验证 `shouldEnterConfirmation` 门控逻辑
- 检查 `try/catch/finally` 异常恢复
- 验证 Dify App 调用时机
- 检查证据清单渲染逻辑

### Test Method 说明

| Method | 含义 |
|---|---|
| Static Code Analysis | 仅通过逐行追踪代码路径验证，未在浏览器中执行 |
| Manual Browser Test | 已在真实浏览器中手动执行并确认通过 |
| Automated Browser Test | 已通过 Playwright/Cypress 等自动化脚本验证 |

### Pass/Fail 说明

| Result | 含义 |
|---|---|
| Pass | 代码路径已静态确认，无需浏览器交互验证 |
| Blocked | 存在需要人工或自动化浏览器验证的步骤，当前无法确认通过 |
| Fail | 代码路径或实际行为不符合预期 |

---

## 测试结果

| Test ID | Scenario | User Inputs | Expected Flow | Expected UI Behavior | Actual Result (Code Analysis) | Pass/Fail | Bug Type | Test Method | Notes |
|---|---|---|---|---|---|---|---|---|---|
| TC01 | 第一轮强情绪低信息输入 | 1. 我真的好难过，我过不下去了 | 保持在 discovery，不调 Dify，不进入 confirmation | 情绪承接文案；不出现 Dify 错误；不出现「如果没有可以说没有」；输入框可继续发送 | isFirstTurn=true, matchesDivorcePattern=true(/过不下去/), hasConcreteFacts=false, isFirstTurnLowInfo=true → 进入 lowInfoGuidance 分支。不调 Dify。setIsThinking 由 finally 统一恢复。 | **Blocked** | 无明显问题 | Static Code Analysis | 需手动验证：1) UI 是否显示正确文案 2) 按钮是否可再次点击 3) console 无 error |
| TC02 | 第一轮「我想离婚」低信息输入 | 1. 我想离婚 | 保持在 discovery，不直接进入 confirmation | 情绪承接+引导补充文案；第二轮输入框可用 | isFirstTurn=true, matchesDivorcePattern=true(/我想离婚/), hasConcreteFacts=false → lowInfoGuidance 分支。不调 Dify。currentStep 保持 discovery。 | **Blocked** | 无明显问题 | Static Code Analysis | 需手动验证：确认文案不含「如果没有可以说没有」 |
| TC03 | 低信息后继续补充原因 | 1. 我想离婚<br>2. 感情不和 | discovery 阶段继续轻量追问或识别离婚，不能按钮卡死 | 不报错，不重复同一问题，不直接生成证据清单 | Turn1: lowInfoGuidance。Turn2: isFirstTurn=false, isNoMore=false → Dify Intent Discovery。try/finally 保障 isThinking 恢复。 | **Blocked** | 无明显问题 | Static Code Analysis | 需手动验证：Dify 返回结果后的 UI 行为；按钮是否可用 |
| TC04 | 低信息+排除其他事项 | 1. 我想离婚<br>2. 感情不和<br>3. 不涉及 | 不能清空「离婚」诉求；不能错误提示「未识别明确诉求」 | 信息不足时应轻量追问登记结婚/对方是否同意；进入 confirmation 时必须有补充提示文案 | Turn3: isTopicNegation=true, hasLastTopics=true → 定向排除。shouldEnterConfirmation: metCount≈2(意愿+已排除), isTopicNegationOrNoMore=true, 2<3 → shouldAskKeyQuestion=true → 输出关键追问。 | **Blocked** | 无明显问题 | Static Code Analysis | 需手动验证：关键追问文案是否输出；是否不显示「未识别明确诉求」 |
| TC05 | 「没有」作为结束追问信号 | 1. 我想离婚<br>2. 感情不和<br>3. 没有 | 「没有」应理解为没有其他事项，不应重复追问 | 不重复上一轮问题；不出现「问题1/2/3」 | isNoMore=true。shouldEnterConfirmation: isTopicNegationOrNoMore=true, metCount 同 TC04 → 同样输出关键追问。不重复上一轮 smartFollowUp。 | **Blocked** | 无明显问题 | Static Code Analysis | 需手动验证：追问文案是否不同于上一轮 |
| TC06 | 明确子女诉求 | 1. 我想离婚，有一个孩子，想争抚养权 | 进入 confirmation | possible claims 至少含离婚、子女抚养权；不显示「婚姻问题」 | hasConcreteFacts=true (/孩子/, /抚养/)。Dify Intent Discovery 被调用 → 返回 possible_claims。shouldEnterConfirmation: nonDivorceClaims>0 → shouldEnter=true。 | **Blocked** | 无明显问题 | Static Code Analysis | Dify 返回的 possible_claims 内容依赖 Dify App 配置，前端无法控制 |
| TC07 | 子女成年排除抚养权 | 1. 有一个孩子<br>2. 成年了，不需要处理孩子问题 | 排除抚养权/抚养费 | 不追问抚养权；成年子女抚养权不作高置信诉求 | Turn2: 「不需要」可能匹配 topicNegationPattern。定向排除依赖 lastFollowUpTopics 上下文。如果未命中 → 走 Dify 路径。 | **Blocked** | 无明显问题 | Static Code Analysis | 依赖 Dify 和 lastFollowUpTopics 的上下文；需手动确认 |
| TC08 | 明确财产诉求 | 1. 婚后买了一套房，想分割房产 | 进入 confirmation | possible claims 含财产分割或房产分割 | hasConcreteFacts=true (/房产/)。Dify 调用 → claims 应含财产分割。shouldEnterConfirmation: nonDivorceClaims>0 → enter。 | **Blocked** | 无明显问题 | Static Code Analysis | Dify 返回内容依赖 Dify App |
| TC09 | 财产转移 | 1. 他最近偷偷转走了很多钱，我想追回 | 进入 confirmation | possible claims 含财产转移/财产分割/追回财产；不只有「离婚」 | hasConcreteFacts=true (/偷偷转走/、/转走.*钱/ 在 CONCRETE_FACT_PATTERNS 中) → isFirstTurnLowInfo=false → Dify Intent Discovery。supplementPropertyTransferClaim 兜底补充「财产转移」「追回财产」「财产分割」。need_more_info fallthrough 也处理。代码路径正确。 | **Pass** | 无明显问题 | Static Code Analysis | 代码路径已静态确认；PROPERTY_TRANSFER_PATTERNS 和 PROPERTY_RECOVERY_PATTERNS 覆盖相关关键词。无需浏览器交互验证 |
| TC10 | 出轨+第三者赠与 | 1. 我老公出轨，给情人花了200多万，我想要回来 | 进入 confirmation | claims 含离婚损害赔偿、追回配偶赠与第三者财产、可含离婚 | hasConcreteFacts=true (/出轨/, /第三者/)。Dify 调用。shouldEnterConfirmation：非仅「离婚」 → enter。 | **Blocked** | 无明显问题 | Static Code Analysis | Dify 返回内容依赖 Dify App |
| TC11 | 家暴输入 | 1. 他打我，我害怕，我想离婚 | 进入 confirmation 或先轻量安全提示 | claims 含离婚、家暴/人身安全保护、离婚损害赔偿；不冷冰冰只问财产 | hasConcreteFacts=true (/打我/ 在 CONCRETE_FACT_PATTERNS 中) → isFirstTurnLowInfo=false → 走 Dify Intent Discovery。不再误入 lowInfoGuidance 分支。 | **Blocked** | 无明显问题 | Static Code Analysis | 代码路径已修复；Dify 返回的具体 claims 内容依赖 Dify App 配置，仍需手动验证 |
| TC12 | 否定财产分割 | 1. 我想离婚，有房子，还有孩子<br>2. 我不想财产分割 | 财产分割被排除，保留离婚/子女 | confirmation 卡片不显示财产分割；confirmed_claims 不含 | detectExcludedClaims(「我不想财产分割」) → NEGATION_KEYWORDS(「不想」)+「财产分割」 → 排除。confirmation 分支过滤。 | **Pass** | 无明显问题 | Static Code Analysis | 代码路径已静态确认；KNOWN_CLAIMS 包含「财产分割」。无需浏览器交互验证 |
| TC13 | 否定抚养费 | 1. 孩子跟我生活，我想要抚养权<br>2. 我不要抚养费 | 排除抚养费，保留抚养权 | 抚养费不能默认勾选 | detectExcludedClaims(「我不要抚养费」) → 匹配「不要」+「抚养费」 → 排除。confirmation 分支清理 selectedClaims。 | **Pass** | 无明显问题 | Static Code Analysis | 代码路径已静态确认；KNOWN_CLAIMS 包含「抚养费」。无需浏览器交互验证 |
| TC14 | confirmation 阶段补充事实 | 1. 我想离婚，有一个孩子<br>2. 页面进入确认后输入：他还家暴过我 | 保持 confirmation，重新整理 possibleClaims | 新增家暴/人身安全保护相关诉求；不调 evidence App | currentStep=confirmation, newlyExcluded=0 → 走 Dify Intent Discovery。wasInConfirmation=true → 合并 claims。不调 Analysis。 | **Blocked** | 无明显问题 | Static Code Analysis | 代码正确路由到 Intent Discovery 而非 Analysis；需手动验证合并结果 |
| TC15 | confirmation 阶段补充否定 | 1. 我想离婚，有房子，有孩子<br>2. 页面进入确认后输入：我不争房子 | 保持 confirmation，排除财产/房产分割 | 房产/财产从 selectedClaims 移除 | detectExcludedClaims(「我不争房子」) → 匹配「不争」+对应 claim → 过滤+清理 selectedClaims。 | **Pass** | 无明显问题 | Static Code Analysis | 代码路径已静态确认；KNOWN_CLAIMS 中「房产分割」可被匹配。无需浏览器交互验证 |
| TC16 | 点击确认生成证据清单 | 1. 我想离婚，有一个孩子，婚后买了一套房<br>2. 勾选 离婚/子女抚养权/财产分割<br>3. 点击确认 | 进入 evidence | 调 Analysis/Evidence App；显示证据清单五分区 | handleConfirmClaims → callAnalysisApi → setCurrentStep(evidence)。EvidencePanel 渲染分区。 | **Blocked** | 无明显问题 | Static Code Analysis | Dify Analysis App 返回内容决定证据清单质量 |
| TC17 | 证据清单默认不勾选 | 沿用 TC16 | 保持 evidence | 所有 checklist 默认未勾选；统计已备 0/N；risk_notes 无 checkbox | evidenceChecklist item 初始 collected:false。riskNotes 渲染为纯文本无 checkbox。 | **Blocked** | 无明显问题 | Static Code Analysis | 需手动视觉验证：checkbox 初始状态和 risk_notes 渲染 |
| TC18 | 证据清单空数据防护 | 1. 我想离婚<br>2. 勾选离婚<br>3. 生成证据清单 | 进入 evidence | 不出现空白卡片；不显示空 item/reason；无数据时友好兜底 | evidenceRaw.filter 排除空项。filterValidEvidence 二次过滤。hasAnyEvidence=false 时 UI 兜底。 | **Blocked** | 无明显问题 | Static Code Analysis | 需手动确认友好兜底文案内容 |
| TC19 | 快速连续输入 | 1-4 连续 | 不能按钮卡死/白屏/重复调错误 App | 最后仍能继续输入，currentStep 合理 | isThinking 入口守卫 + try/finally 兜底恢复。重复调 Analysis 被 currentStep 门控阻止。 | **Blocked** | 无明显问题 | Static Code Analysis | 需手动暴力点击测试 extreme case |
| TC20 | 滚动与长对话 | 8 轮连续输入 | 多轮不崩；左右区域可滚动；输入框固定底部 | 历史消息可查看；无布局遮挡 | chatScrollRef + messagesEndRef 控制滚动。textarea 固定底部。EvidencePanel 独立渲染。 | **Blocked** | 无明显问题 | Static Code Analysis | 需手动验证 8 轮后的视觉效果 |

---

## 代码路径分析详情

### TC01-TC02：第一轮低信息输入

**代码路径**：handleSubmit → isFirstTurn=true → matchesDivorcePattern 或 isEmotionLowInfoInput → hasConcreteFacts=false → isFirstTurnLowInfo=true → 进入 lowInfoGuidance 分支（第~495行）。

**关键检查**：
- `getLowInfoGuidanceMessage()` 已正确定义
- 不调用 Dify（该分支内无 callIntentApi）
- `setInput("")` 清空输入框
- `setIsThinking` 由外层 finally 统一恢复
- LEGAL_FACT_KEYWORDS 已移除 "离婚"，确保 `detectEmotionLowInfo("我想离婚，我好痛苦")` 返回 true

### TC04-TC05："不涉及"/"没有" 定向否定

**代码路径**：isTopicNegation 或 isNoMore=true → 定向排除逻辑 → `shouldEnterConfirmation` 门控。

**shouldEnterConfirmation 判断**：
- `isTopicNegationOrNoMore=true` 时，需要 ≥3 个条件才允许进入
- 条件 <3 时，`shouldAskKeyQuestion=true`
- 输出 `getKeyQuestionMessage()`，设置 `hasAskedDivorceKeyQuestionRef.current=true`
- 下次用户回复后，`hasAskedKeyQuestion=true` → `shouldEnter=true`

### TC06-TC11：具体事实 → Dify → confirmation

**代码路径**：hasConcreteFacts=true → Dify Intent Discovery → possible_claims 返回 → `shouldEnterConfirmation`。

**门控逻辑**：
- 多个诉求类型（不只「离婚」）→ `shouldEnter=true`
- 只有「离婚」 → 检查 5 个条件维度
- Dify 路径 `isTopicNegationOrNoMore=false` → 需要 ≥2 个条件

### TC12-TC13, TC15：否定诉求处理

**代码路径**：`detectExcludedClaims(userContent)` → NEGATION_KEYWORDS + KNOWN_CLAIMS 匹配。

**confirmation 阶段**：newlyExcluded>0 → 过滤 possibleClaims + 清理 selectedClaims。

### TC16-TC18：证据清单

**数据规范化**：
- 兼容多种 Dify 返回格式
- 过滤空证据项
- collected 初始为 false
- risk_notes 渲染为纯文本

### TC19-TC20：稳定性

**并发/卡死防护**：
- `if(isThinking) return` 入口守卫
- `try/finally` 统一恢复 isThinking
- 多次 setMessages 调用被 React 18 批处理

---

## 需手动验证的测试用例

以下用例依赖 Dify App 返回内容或需要浏览器交互验证，当前标记为 **Blocked**：

| Test ID | Blocked 原因 | 手动验证重点 |
|---|---|---|
| TC01 | 需手动验证 | UI 文案是否正确、按钮是否可再次点击、console 无 error |
| TC02 | 需手动验证 | 文案不含「如果没有可以说没有」 |
| TC03 | 需手动验证 | Dify 返回后的 UI 行为、按钮状态 |
| TC04 | 需手动验证 | 关键追问文案输出、不显示「未识别明确诉求」 |
| TC05 | 需手动验证 | 追问文案是否不同于上一轮 |
| TC06 | Dify 返回内容依赖 | Dify 是否返回包含「子女抚养权」的 possible_claims |
| TC07 | Dify 返回内容依赖 | 「不需要处理孩子问题」后是否排除了抚养权相关 claims |
| TC08 | Dify 返回内容依赖 | Dify 是否返回「房产分割」/「财产分割」 |
| TC09 | Dify 返回内容 + 代码兜底 | PROPERTY_TRANSFER_PATTERNS/PROPERTY_RECOVERY_PATTERNS 关键词已覆盖；supplementPropertyTransferClaim 兜底补充 claims；need_more_info fallthrough 处理财产转移 |
| TC10 | Dify 返回内容依赖 | Dify 是否返回「离婚损害赔偿」+「追回赠与财产」 |
| TC11 | Dify 返回内容依赖 | 「他打我」已被 CONCRETE_FACT_PATTERNS 正确识别（/打我/ 已添加）；Dify 返回的 claims 内容仍需验证 |
| TC14 | 需手动验证 | 合并 old+new claims 的结果是否正确 |
| TC16 | Dify 返回内容依赖 | Analysis App 返回的证据清单质量 |
| TC17 | 需手动视觉验证 | checkbox 初始状态、risk_notes 渲染无 checkbox |
| TC18 | 需手动确认 | 友好兜底文案内容 |
| TC19 | 需手动测试 | 快速连续点击的极端情况 |
| TC20 | 需手动验证 | 8 轮对话后的滚动和布局效果 |

## 可静态确认通过的用例

以下用例的代码路径已通过静态分析完整验证，无需浏览器交互即可确认：

| Test ID | 验证结论 |
|---|---|
| TC09 | PROPERTY_TRANSFER_PATTERNS (/偷偷转走/、/转走.*钱/、/追回/、/要回来/ 等) 覆盖财产转移+追回关键词；supplementPropertyTransferClaim 兜底补充「财产转移」「追回财产」「财产分割」；need_more_info fallthrough 也处理 |
| TC12 | detectExcludedClaims 可正确匹配「不想财产分割」并排除；KNOWN_CLAIMS 包含「财产分割」 |
| TC13 | detectExcludedClaims 可正确匹配「不要抚养费」并排除；KNOWN_CLAIMS 包含「抚养费」 |
| TC15 | detectExcludedClaims 可正确匹配「不争房子」并排除；KNOWN_CLAIMS 包含「房产分割」 |
