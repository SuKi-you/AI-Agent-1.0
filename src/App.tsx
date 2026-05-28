import { useState, useRef, useEffect, useCallback } from "react"
import {
  ArrowUp as ArrowUpIcon,
  Sun as SunIcon,
  Moon as MoonIcon,
  Mic as MicIcon,
  Square as SquareIcon,
  Scale as ScaleIcon,
  FileCheck as FileCheckIcon,
  X as XIcon,
} from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"

import {
  detectExcludedClaims,
  getLowInfoGuidanceMessage,
  detectDivorceIntent,
  runClaimPipeline,
  isValidClaim,
  CONCRETE_FACT_PATTERNS,
} from "@/utils/claimDetection"

interface Claim {
  id: string
  text: string
  selected: boolean
  category: string
}

interface EvidenceItem {
  id: string
  text: string
  collected: boolean
  priority: "high" | "medium" | "low"
  category: string
}

interface LegalAnalysisItem {
  legal_relation: string
  related_claims: string
  legal_elements: string[]
  facts_to_prove: string[]
}

interface CoreEvidenceItem {
  evidence: string
  evidence_type: string
  proves: string
  corresponding_fact: string
  related_claims: string
  note: string
}

interface AnalysisResult {
  caseType: string
  keyFacts: string[]
  claims: Claim[]
  risks: string[]
  evidenceChecklist: EvidenceItem[]
  missingInfo: string[]
  legalAnalysis: LegalAnalysisItem[]
  coreEvidence: CoreEvidenceItem[]
  supportingEvidence: CoreEvidenceItem[]
}

interface Message {
  role: "user" | "assistant"
  content: string
  analysis?: AnalysisResult
}



// ── 以下常量与函数已抽离至 @/utils/claimDetection.ts 和 @/utils/stateMachine.ts ──

export function App() {
  const { theme, setTheme } = useTheme()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isThinking, setIsThinking] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [visibleSections, setVisibleSections] = useState(0)
  const [currentAnalysis, setCurrentAnalysis] = useState<AnalysisResult | null>(null)
  const [currentStep, setCurrentStep] = useState<"discovery" | "confirmation" | "evidence">("discovery")
  const [questions, setQuestions] = useState<string[]>([])
  const [possibleClaims, setPossibleClaims] = useState<Array<{ claim: string; confidence: string; reason: string }>>([])
  const [rawAnalysisResult, setRawAnalysisResult] = useState<Record<string, unknown> | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const isUserScrollingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const [caseDescription, setCaseDescription] = useState<string[]>([])
  const [excludedClaims, setExcludedClaims] = useState<string[]>([])
  const [selectedClaims, setSelectedClaims] = useState<Set<string>>(new Set())
  const lastQueryRef = useRef<string>("")

  const scrollToBottom = useCallback((force = false) => {
    const el = chatScrollRef.current
    if (!el) return
    if (!force && isUserScrollingRef.current) return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [])

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current
    if (!el) return
    const threshold = 80
    isUserScrollingRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > threshold
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, visibleSections, scrollToBottom])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + "px"
    }
  }, [input])

  const callIntentApi = async (query: string) => {
    const body = { query, user: "demo-user" }
    console.log("[callIntentApi] request body:", body)
    const response = await fetch("/api/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      console.error("[callIntentApi] ERROR status:", response.status, "body:", errorData)
      throw new Error(errorData?.error || errorData?.detail || `HTTP ${response.status}`)
    }
    const data = await response.json()
    console.log("[callIntentApi] raw response:", data)
    if (data.error) { throw new Error(data.error) }
    return data.result
  }

  const callAnalysisApi = async (query: string, confirmedClaims: string[]) => {
    const confirmedClaimsString = confirmedClaims.join(", ")
    const inputs = { confirmed_claims: confirmedClaimsString }
    const body = { inputs, query, response_mode: "blocking", user: "demo-user" }
    console.log("[Analysis Request Body]", JSON.stringify(body, null, 2))
    const response = await fetch("/api/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    console.log("[Analysis Response Status]", response.status, response.statusText)
    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      console.error("[Analysis Error] HTTP", response.status, JSON.stringify(errorData, null, 2))
      throw new Error(errorData?.error || errorData?.detail || `HTTP ${response.status}`)
    }
    const data = await response.json()
    console.log("[Analysis Raw Response]", JSON.stringify(data, null, 2))
    if (data.error) {
      console.error("[Analysis Error] Dify returned error:", JSON.stringify(data.error, null, 2))
      throw new Error(data.error)
    }
    return data.result
  }

  // 前端侧证据补充：当 Dify Analysis App 返回不完整证据清单时，根据已确认诉求补充缺失项
  const ensureEvidenceCoverage = (
    confirmedClaims: string[],
    existingEvidence: Array<{ text?: string; item?: string; reason?: string; priority?: string; category?: string }>,
    existingRisks: string[]
  ) => {
    const evidence = [...existingEvidence]
    const risks = [...existingRisks]

    const hasClaim = (kw: string) => confirmedClaims.some(c => c.includes(kw))
    const evidenceTexts = () => evidence.map(e => e.text || e.item || "")

    // ── 财产分割 / 房产分割 ──────────────────────────────
    if (hasClaim("财产分割") || hasClaim("房产分割") || hasClaim("房产")) {
      const items = [
        { text: "房产证 / 不动产权证书", priority: "high", category: "财产分割", reason: "证明房屋产权归属及购买时间" },
        { text: "购房合同 / 房屋买卖合同", priority: "high", category: "财产分割", reason: "证明购房事实及交易价格" },
        { text: "房贷合同 / 抵押贷款合同", priority: "high", category: "房产分割", reason: "证明房贷余额及还款义务" },
        { text: "房贷还款记录 / 银行还款流水", priority: "medium", category: "房产分割", reason: "区分婚前/婚后还款金额" },
        { text: "首付款支付凭证 / 首付款来源证明", priority: "high", category: "房产分割", reason: "证明首付款出资来源及比例" },
        { text: "夫妻共同财产清单（车辆、存款、理财、股权等）", priority: "high", category: "财产分割", reason: "全面梳理待分割财产" },
        { text: "其他财产线索（对方名下隐藏资产）", priority: "medium", category: "财产分割", reason: "防止对方转移或隐匿财产" },
      ]
      for (const item of items) {
        const key = item.text.slice(0, 4)
        if (!evidenceTexts().some(t => t.includes(key))) {
          evidence.push(item)
        }
      }
    }

    // ── 财产转移 ────────────────────────────────────────
    if (hasClaim("财产转移")) {
      const items = [
        { text: "银行账户流水 / 交易明细（近1-2年）", priority: "high", category: "财产转移", reason: "反映资金流向及异常转账" },
        { text: "大额转账记录 / 转账凭证", priority: "high", category: "财产转移", reason: "锁定转移时间及金额" },
        { text: "异常取款记录 / 大额取现凭证", priority: "high", category: "财产转移", reason: "防止对方以现金形式转移财产" },
        { text: "转账对象身份信息 / 收款方线索", priority: "medium", category: "财产转移", reason: "追溯资金最终流向" },
        { text: "异常消费记录 / 大额消费凭证", priority: "medium", category: "财产转移", reason: "识别非正常家庭支出的消费" },
        { text: "财产去向线索（聊天记录、录音、短信等）", priority: "medium", category: "财产转移", reason: "辅助证明对方转移意图" },
        { text: "财产保全申请材料（如已申请）", priority: "low", category: "财产转移", reason: "防止财产进一步流失" },
      ]
      for (const item of items) {
        const key = item.text.slice(0, 4)
        if (!evidenceTexts().some(t => t.includes(key))) {
          evidence.push(item)
        }
      }
    }

    // ── 债务处理 ────────────────────────────────────────
    if (hasClaim("债务处理") || hasClaim("债务")) {
      const items = [
        { text: "借款合同 / 贷款合同", priority: "high", category: "债务处理", reason: "证明债务金额、利率、期限" },
        { text: "欠条 / 借据", priority: "high", category: "债务处理", reason: "民间借贷的关键书面证据" },
        { text: "信用卡账单 / 消费记录", priority: "high", category: "债务处理", reason: "反映信用卡债务规模及用途" },
        { text: "网贷平台借款记录 / 截图", priority: "high", category: "债务处理", reason: "证明网贷债务存在及金额" },
        { text: "贷款平台借款合同 / 协议", priority: "high", category: "债务处理", reason: "厘清各类平台借贷明细" },
        { text: "债权人身份信息 / 联系方式", priority: "medium", category: "债务处理", reason: "便于法院核实债务真实性" },
        { text: "债务用途证明（是否用于家庭共同生活）", priority: "high", category: "债务处理", reason: "判断是否属于夫妻共同债务的关键" },
        { text: "还款记录 / 还款凭证", priority: "medium", category: "债务处理", reason: "反映已偿还金额及剩余债务" },
        { text: "催收记录 / 催收通知", priority: "medium", category: "债务处理", reason: "证明债务真实存在且已到期" },
        { text: "与债权人 / 对方的债务相关聊天记录、录音", priority: "medium", category: "债务处理", reason: "辅助证明债务知情及用途" },
      ]
      for (const item of items) {
        const key = item.text.slice(0, 4)
        if (!evidenceTexts().some(t => t.includes(key))) {
          evidence.push(item)
        }
      }

      // 债务风险提示
      const debtRisks = [
        "是否为夫妻共同债务需法院认定，需证明债务用于夫妻共同生活或共同经营",
        "单方举债不一定属于共同债务，债权人主张共同债务需承担举证责任",
        "建议保留所有转账凭证和债务沟通记录，防止对方否认债务或夸大金额",
      ]
      for (const risk of debtRisks) {
        if (!risks.some(r => r.includes(risk.slice(0, 12)))) {
          risks.push(risk)
        }
      }
    }

    return { supplementedEvidence: evidence, supplementedRisks: risks }
  }

  const handleSubmit = async () => {
    console.log("[handleSubmit] called, input:", JSON.stringify(input), "isThinking:", isThinking, "currentStep:", currentStep)
    // 防止并发发送：如果 isThinking 为 true，直接拒绝，由 finally 兜底恢复
    if (isThinking) {
      console.log("[handleSubmit] BLOCKED — already thinking (isThinking=true), rejecting concurrent call")
      return
    }
    if (!input.trim()) {
      console.log("[handleSubmit] BLOCKED — input empty")
      return
    }

    const userContent = input.trim()

    try {
      setIsThinking(true)
      // ═══════════════════════════════════════════
      // 所有分支在此 try 块内执行，finally 保证 isThinking 恢复
      // ═══════════════════════════════════════════

    // 检测本轮否定表达
    const newlyExcluded = detectExcludedClaims(userContent)
    const INVALID_LABELS = ["婚姻问题", "家庭问题", "感情问题", "法律问题", "纠纷", "婚姻家事", "情感困扰"]
    const validExcluded = newlyExcluded.filter(c => !INVALID_LABELS.some(il => c.includes(il) || il.includes(c)))

    // 追加用户输入到案情上下文
    const updatedCase = [...caseDescription, userContent]
    setCaseDescription(updatedCase)
    const updatedExcluded = [...excludedClaims]
    for (const c of validExcluded) {
      if (!updatedExcluded.includes(c)) updatedExcluded.push(c)
    }

    const userMessage: Message = { role: "user", content: userContent }
    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setVisibleSections(0)

    console.log("[handleSubmit] currentStep:", currentStep)
    console.log("[handleSubmit] detectedExcludedClaims:", newlyExcluded)
    console.log("[handleSubmit] excludedClaims:", updatedExcluded)
    console.log("[handleSubmit] accumulatedUserInput:", JSON.stringify(updatedCase))

    // ═══════════════════════════════════════════
    // DISCOVERY 阶段
    // ═══════════════════════════════════════════
    if (currentStep === "discovery") {
      const accText = updatedCase.join(" ")
      const hasConcreteFacts = CONCRETE_FACT_PATTERNS.some((p) => p.test(accText))

      if (!hasConcreteFacts) {
        // 无具体事实 → 本地情绪承接引导，不调 Dify
        console.log("[handleSubmit] discovery — no concrete facts, local guidance only")
        setExcludedClaims(updatedExcluded)
        const assistantMsg: Message = { role: "assistant", content: getLowInfoGuidanceMessage() }
        setMessages((prev) => [...prev, assistantMsg])
        return
      }

      // 有具体事实 → 调用 Intent Discovery
      console.log("[handleSubmit] discovery — has concrete facts, calling Dify")
      setQuestions([])

      let fullQuery = updatedCase.map((line, i) => `${i + 1}. ${String(line)}`).join("\n") || userContent
      if (updatedExcluded.length > 0) {
        fullQuery += `\n\n用户已明确排除的诉求：\n${updatedExcluded.map((c) => `- ${c}`).join("\n")}`
      }
      lastQueryRef.current = fullQuery

      try {
        const result = await callIntentApi(fullQuery)
        const difyClaims = Array.isArray(result?.possible_claims) ? result.possible_claims : []
        const filtered = difyClaims.filter(
          (c: { claim: string }) => !updatedExcluded.some((ex) => c.claim.includes(ex) || ex.includes(c.claim))
        )
        const claims = runClaimPipeline(filtered, accText, updatedExcluded)

        console.log("[handleSubmit] Dify claims:", difyClaims.map((c: { claim: string }) => c.claim))
        console.log("[handleSubmit] after runClaimPipeline:", claims.map((c) => c.claim))

        if (claims.length === 0) {
          setExcludedClaims(updatedExcluded)
          const assistantMsg: Message = {
            role: "assistant",
            content: "我还没有识别出明确诉求，请补充更多具体信息（例如孩子、财产、出轨、家暴等）。",
          }
          setMessages((prev) => [...prev, assistantMsg])
          return
        }

        setPossibleClaims(claims)
        setExcludedClaims(updatedExcluded)
        setCaseDescription([])
        setSelectedClaims(new Set())
        setCurrentStep("confirmation")
        console.log("[handleSubmit] → entering confirmation")
        const assistantMsg: Message = {
          role: "assistant",
          content: "根据您的描述，我识别出以下可能的诉求，请确认您想主张的内容：",
        }
        setMessages((prev) => [...prev, assistantMsg])
      } catch (err) {
        console.error("[handleSubmit] Dify API error (discovery):", err)
        setExcludedClaims(updatedExcluded)
        const assistantMsg: Message = {
          role: "assistant",
          content: "网络出现异常，请稍后重新输入。",
        }
        setMessages((prev) => [...prev, assistantMsg])
      }
      return
    }

    // ═══════════════════════════════════════════
    // CONFIRMATION 阶段
    // ═══════════════════════════════════════════
    if (currentStep === "confirmation") {
      // "没有更多"类回复 → 不调 Dify，保持现状
      const noMorePattern = /^(没有|没了|无|暂时没有|没有其他|就这些|就这样|没有了|没啥了|差不多了)$/
      if (noMorePattern.test(userContent) && validExcluded.length === 0) {
        console.log("[handleSubmit] confirmation — noMore detected, staying")
        setExcludedClaims(updatedExcluded)
        const assistantMsg: Message = {
          role: "assistant",
          content: "好的。当前诉求没有变化，请确认或点击下方按钮生成证据清单。",
        }
        setMessages((prev) => [...prev, assistantMsg])
        return
      }

      if (validExcluded.length > 0) {
        // 明确否定 → 过滤排除的诉求
        console.log("[handleSubmit] confirmation — exclusion:", validExcluded)
        setExcludedClaims(updatedExcluded)
        const filtered = possibleClaims.filter(
          (c) => !updatedExcluded.some((ex) => c.claim.includes(ex) || ex.includes(c.claim))
        )
        setSelectedClaims((prev) => {
          const next = new Set(prev)
          for (const c of prev) {
            if (updatedExcluded.some((ex) => c.includes(ex) || ex.includes(c))) {
              next.delete(c)
            }
          }
          return next
        })

        if (filtered.length > 0) {
          setPossibleClaims(filtered)
          const assistantMsg: Message = {
            role: "assistant",
            content: "已收到您的排除信息。当前可主张的诉求已更新，请确认：",
          }
          setMessages((prev) => [...prev, assistantMsg])
        } else {
          // 全部被排除 → 检查离婚意图
          const accText = updatedCase.join(" ")
          if (detectDivorceIntent(accText)) {
            const fallbackDivorce = [{ claim: "离婚", confidence: "medium", reason: "用户明确表达离婚意愿" }]
            setPossibleClaims(fallbackDivorce)
            setSelectedClaims(new Set())
            const assistantMsg: Message = {
              role: "assistant",
              content: "已收到您的排除信息。当前仍可主张离婚诉求，请确认：",
            }
            setMessages((prev) => [...prev, assistantMsg])
          } else {
            setPossibleClaims([])
            setSelectedClaims(new Set())
            const assistantMsg: Message = {
              role: "assistant",
              content: "我还没有识别出明确诉求，请补充是否涉及离婚、子女、财产、出轨或家暴。",
            }
            setMessages((prev) => [...prev, assistantMsg])
          }
        }
        return
      }

      // 补充事实 → 重新调用 Intent Discovery → 合并
      console.log("[handleSubmit] confirmation — supplement facts, calling Dify")
      setQuestions([])

      let fullQuery = updatedCase.map((line, i) => `${i + 1}. ${String(line)}`).join("\n") || userContent
      if (updatedExcluded.length > 0) {
        fullQuery += `\n\n用户已明确排除的诉求：\n${updatedExcluded.map((c) => `- ${c}`).join("\n")}`
      }
      lastQueryRef.current = fullQuery

      try {
        const result = await callIntentApi(fullQuery)
        const difyClaims = Array.isArray(result?.possible_claims) ? result.possible_claims : []
        const filtered = difyClaims.filter(
          (c: { claim: string }) => !updatedExcluded.some((ex) => c.claim.includes(ex) || ex.includes(c.claim))
        )
        const accText = updatedCase.join(" ")
        const claims = runClaimPipeline(filtered, accText, updatedExcluded)

        console.log("[handleSubmit] Dify claims (supplement):", difyClaims.map((c: { claim: string }) => c.claim))
        console.log("[handleSubmit] after runClaimPipeline:", claims.map((c) => c.claim))

        if (claims.length === 0) {
          setExcludedClaims(updatedExcluded)
          const assistantMsg: Message = {
            role: "assistant",
            content: possibleClaims.length > 0
              ? "当前诉求没有变化，请确认或继续补充："
              : "我还没有识别出明确诉求，请补充更多具体信息。",
          }
          setMessages((prev) => [...prev, assistantMsg])
          return
        }

        // 合并已有诉求，保留已勾选
        const existingClaimTexts = new Set(possibleClaims.map((c) => c.claim))
        const merged = [...possibleClaims]
        const newlyMerged: Array<{ claim: string; confidence: string; reason: string }> = []
        for (const nc of claims) {
          if (!existingClaimTexts.has(nc.claim)) {
            merged.push(nc)
            newlyMerged.push(nc)
          }
        }

        console.log("[handleSubmit] merged claims:", merged.map((c) => c.claim))
        console.log("[handleSubmit] newlyMerged:", newlyMerged.map((c) => c.claim))

        setPossibleClaims(merged)
        setExcludedClaims(updatedExcluded)
        setCaseDescription([])

        // 保留用户已手动勾选的诉求，新诉求默认不勾选
        // selectedClaims 通过 ClaimSelectionUI 的 useState 同步，不需要额外 setSelectedClaims

        const assistantMsg: Message = {
          role: "assistant",
          content: newlyMerged.length > 0
            ? "已根据您补充的信息重新整理诉求，请确认："
            : "当前诉求没有变化，请确认或继续补充：",
        }
        setMessages((prev) => [...prev, assistantMsg])
      } catch (err) {
        console.error("[handleSubmit] Dify API error (confirmation supplement):", err)
        const assistantMsg: Message = {
          role: "assistant",
          content: "网络出现异常，请稍后重新输入。",
        }
        setMessages((prev) => [...prev, assistantMsg])
      }
      return
    }

    // evidence 阶段不允许自由输入
    console.log("[handleSubmit] evidence stage — input ignored")

  } catch (error) {
    console.error("[handleSubmit] ===== RUNTIME ERROR =====")
    console.error("[handleSubmit] unexpected error:", error)
    console.error("[handleSubmit] error message:", (error as Error)?.message ?? String(error))
    console.error("[handleSubmit] error stack:", (error as Error)?.stack ?? "无堆栈")
    console.error("[handleSubmit] error type:", typeof error)
    console.error("[handleSubmit] ===== END RUNTIME ERROR =====")
    const assistantMessage: Message = {
      role: "assistant",
      content: "系统出现错误，请稍后重试。",
    }
    setMessages((prev) => [...prev, assistantMessage])
  } finally {
    console.log("[handleSubmit] finally — ensuring isThinking=false")
    setIsThinking(false)
  }
  }

  const handleConfirmClaims = async (selectedClaimTexts: string[]) => {
    // 过滤掉已排除的诉求（模糊匹配）
    const filteredSelected = selectedClaimTexts.filter(
      (c) => !excludedClaims.some((ex) => c.includes(ex) || ex.includes(c))
    )
    console.log("[handleConfirmClaims] selectedClaims:", selectedClaimTexts)
    console.log("[handleConfirmClaims] excludedClaims:", excludedClaims)
    console.log("[handleConfirmClaims] filteredSelected (sent to Analysis):", filteredSelected)

    if (filteredSelected.length === 0) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `您选择的诉求均已被排除。当前排除列表：${excludedClaims.join("、")}。请重新选择或补充案情。`,
      }])
      return
    }

    setIsThinking(true)
    setCurrentStep("evidence")
    setPossibleClaims([])
    setSelectedClaims(new Set())

    const confirmedClaimsStr = filteredSelected.join("、")
    const userMessage: Message = { role: "user", content: `确认诉求：${confirmedClaimsStr}` }
    setMessages((prev) => [...prev, userMessage])

    const originalQuery = lastQueryRef.current || selectedClaimTexts.join("，")

    try {
      const result = await callAnalysisApi(originalQuery, filteredSelected)
      console.log("[handleConfirmClaims] raw result:", result)
      console.log("[handleConfirmClaims] result keys:", result ? Object.keys(result) : "null/undefined")
      console.log("[Analysis Raw Response]", JSON.stringify(result).slice(0, 1000))

      if (result && typeof result === "object" && !Array.isArray(result)) {
        // 处理 Dify 返回非 JSON 文本（raw_text）的情况
        if (result.raw_text && Object.keys(result).length === 1) {
          console.warn("[handleConfirmClaims] Dify returned raw_text (non-JSON answer), attempting text extraction")
          const rawText = String(result.raw_text)
          // 尝试从 markdown 中提取 JSON
          const jsonMatch = rawText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) || rawText.match(/(\{[\s\S]*\})/)
          if (jsonMatch) {
            try {
              const extracted = JSON.parse(jsonMatch[1] || jsonMatch[0])
              console.log("[handleConfirmClaims] extracted JSON from raw_text:", Object.keys(extracted))
              // Recurse with the extracted object
              // 不递归，直接在当前分支继续处理 extracted
              Object.assign(result, extracted)
            } catch {
              console.warn("[handleConfirmClaims] could not parse JSON from raw_text")
            }
          }
          // 如果提取失败，至少显示 raw_text 内容
          if (!result.evidence_checklist && !result.priority_evidence && !result.general_evidence && !result.claims) {
            setIsThinking(false)
            const assistantMessage: Message = {
              role: "assistant",
              content: String(result.raw_text || "分析完成，但未能解析结构化结果。请重试。"),
            }
            setMessages((prev) => [...prev, assistantMessage])
            return
          }
        }

        // 兼容 Dify Analysis App 的多种返回格式，并过滤已排除诉求
        let claimsRaw = Array.isArray(result.claims)
          ? result.claims
          : Array.isArray(result.confirmed_claims)
          ? result.confirmed_claims
          : filteredSelected
        if (Array.isArray(claimsRaw)) {
          claimsRaw = claimsRaw.filter((c: string | { claim?: string; text?: string }) => {
            const name = typeof c === "string" ? c : (c.claim || c.text || "")
            return !excludedClaims.some((ex) => name.includes(ex) || ex.includes(name))
          })
        }

        // 证据：可能是 evidence_checklist、evidenceChecklist 数组，
        // 也可能是 priority_evidence + general_evidence 的组合格式
        let evidenceRaw: Array<string | { text?: string; item?: string; reason?: string; priority?: string; category?: string }> = []
        if (Array.isArray(result.evidence_checklist)) {
          evidenceRaw = result.evidence_checklist
        } else if (Array.isArray(result.evidenceChecklist)) {
          evidenceRaw = result.evidenceChecklist
        } else {
          const priorityEvidence = Array.isArray(result.priority_evidence) ? result.priority_evidence : []
          const generalEvidence = Array.isArray(result.general_evidence) ? result.general_evidence : []
          evidenceRaw = [
            ...priorityEvidence.map((e: { item?: string; reason?: string }) => ({ ...e, text: e.item, priority: "high" as const, category: "关键证据" })),
            ...generalEvidence.map((e: { item?: string; reason?: string }) => ({ ...e, text: e.item, priority: "medium" as const, category: "一般证据" })),
          ]
        }

        // 过滤空证据项
        evidenceRaw = evidenceRaw.filter((e) => {
          if (typeof e === "string") return e.trim() !== ""
          const name = e.item || e.title || e.name || e.material || e.evidence_name || e.text || ""
          return String(name).trim() !== ""
        })

        // Fallback: Dify 返回了 { item, reason } 单条而非 evidence 数组
        if (evidenceRaw.length === 0 && result.item && !result.claims && !result.case_type) {
          console.warn("[handleConfirmClaims] Dify returned single { item, reason } instead of full evidence checklist, wrapping")
          evidenceRaw = [{ text: String(result.item), reason: String(result.reason || ""), priority: "medium", category: "证据材料" }]
        }

        // 风险提示：可能是 risks、risk_notes
        let risksRaw: Array<string | { text?: string; item?: string; note?: string }> = Array.isArray(result.risks)
          ? result.risks
          : Array.isArray(result.risk_notes)
          ? result.risk_notes
          : []

        // 缺失信息：可能是 missing_info、missingInfo、missing_evidence
        const missingRaw = Array.isArray(result.missing_info)
          ? result.missing_info
          : Array.isArray(result.missingInfo)
          ? result.missingInfo
          : Array.isArray(result.missing_evidence)
          ? result.missing_evidence
          : []

        // 前端证据补充：Dify 返回不完整时，按已确认诉求补充缺失证据项
        {
          const { supplementedEvidence, supplementedRisks } = ensureEvidenceCoverage(filteredSelected, evidenceRaw, risksRaw)
          console.log(
            "[handleConfirmClaims] ensureEvidenceCoverage: evidence",
            evidenceRaw.length, "→", supplementedEvidence.length,
            "risks", risksRaw.length, "→", supplementedRisks.length
          )
          evidenceRaw = supplementedEvidence
          risksRaw = supplementedRisks as typeof risksRaw
        }

        console.log("[handleConfirmClaims] evidenceRaw:", evidenceRaw.length, "risksRaw:", risksRaw.length, "missingRaw:", missingRaw.length)

        const analysis: AnalysisResult = {
          caseType: String(result.case_type || result.caseType || "婚姻家庭纠纷"),
          keyFacts: Array.isArray(result.key_facts)
            ? result.key_facts.map(String)
            : Array.isArray(result.keyFacts)
            ? result.keyFacts.map(String)
            : [],
          claims: claimsRaw.map((c: string | { text?: string; claim?: string; item?: string; category?: string }, i: number) => ({
            id: String(i + 1),
            text: typeof c === "string" ? c : String(c.text || c.claim || c.item || ""),
            selected: true,
            category: typeof c === "string" ? "诉求" : String(c.category || "诉求"),
          })),
          risks: risksRaw.map((r: string | { text?: string; item?: string; note?: string }) =>
            typeof r === "string" ? r : String(r.text || r.item || r.note || "")
          ),
          evidenceChecklist: evidenceRaw.map(
            (e, i: number) => {
              const item = e as Record<string, string | undefined>
              return {
                id: `e${i + 1}`,
                text: String(item.text || item.item || item.title || item.name || item.material || item.evidence_name || ""),
                collected: false,
                priority: (item.priority === "high" || item.priority === "medium" || item.priority === "low") ? item.priority : "medium",
                category: String(item.category || "证据材料"),
              }
            }
          ),
          missingInfo: (() => {
            // 新结构 missing_information 优先，兼容旧字段
            const newMissingInfo = Array.isArray(result.missing_information) ? result.missing_information : []
            const items: string[] = []
            if (newMissingInfo.length > 0) {
              newMissingInfo.forEach((m: unknown) => {
                if (typeof m === "string") items.push(m)
                else if (m && typeof m === "object") {
                  const o = m as Record<string, unknown>
                  items.push(String(o.item || o.title || o.description || o.name || JSON.stringify(m)))
                }
              })
            } else {
              missingRaw.forEach((m: string | { text?: string; item?: string; title?: string; name?: string; material?: string; evidence_name?: string; reason?: string; description?: string; purpose?: string; detail?: string }) =>
                typeof m === "string" ? items.push(m) : items.push(`${m.item || m.title || m.name || m.material || m.evidence_name || m.text || ""}${(m.reason || m.description || m.purpose || m.detail) ? `：${m.reason || m.description || m.purpose || m.detail}` : ""}`)
              )
            }
            const lawyerChecklist = Array.isArray(result.lawyer_visit_checklist) ? result.lawyer_visit_checklist : []
            if (lawyerChecklist.length > 0) {
              items.push("【咨询律师前建议准备】")
              lawyerChecklist.forEach((tip: string) => items.push(`  → ${tip}`))
            }
            return items
          })(),
          legalAnalysis: Array.isArray(result.legal_analysis) ? result.legal_analysis : [],
          coreEvidence: (() => {
            const el = (result as Record<string, unknown>).evidence_list as Record<string, unknown> | undefined
            return Array.isArray(el?.core_evidence) ? el!.core_evidence as CoreEvidenceItem[] : []
          })(),
          supportingEvidence: (() => {
            const el = (result as Record<string, unknown>).evidence_list as Record<string, unknown> | undefined
            return Array.isArray(el?.supporting_evidence) ? el!.supporting_evidence as CoreEvidenceItem[] : []
          })(),
        }
        console.log("[handleConfirmClaims] built analysis.evidenceChecklist length:", analysis.evidenceChecklist.length)
        console.log("[handleConfirmClaims] built analysis.claims length:", analysis.claims.length)
        console.log("[handleConfirmClaims] built analysis.risks length:", analysis.risks.length)
        setCurrentAnalysis(analysis)
        setRawAnalysisResult(result as Record<string, unknown>)
        setIsThinking(false)
        const assistantMessage: Message = { role: "assistant", content: "", analysis }
        setMessages((prev) => [...prev, assistantMessage])
        revealSections()
      } else if (result && typeof result === "string") {
        setIsThinking(false)
        const assistantMessage: Message = { role: "assistant", content: result }
        setMessages((prev) => [...prev, assistantMessage])
      } else {
        setIsThinking(false)
        const assistantMessage: Message = {
          role: "assistant",
          content: "分析完成，但返回格式异常。请重试。",
        }
        setMessages((prev) => [...prev, assistantMessage])
      }
    } catch (err) {
      console.error("[Analysis Error]", {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        type: typeof err,
      })
      setIsThinking(false)
      const errorDetail = err instanceof Error ? err.message : "未知错误"
      const assistantMessage: Message = { role: "assistant", content: `分析请求失败：${errorDetail}` }
      setMessages((prev) => [...prev, assistantMessage])
    }
  }

  const revealSections = () => {
    const totalSections = 5
    let current = 0
    const interval = setInterval(() => {
      current++
      setVisibleSections(current)
      if (current >= totalSections) clearInterval(interval)
    }, 300)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.lang = "zh-CN"
    recognition.interimResults = true
    recognition.continuous = true
    recognitionRef.current = recognition

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = ""
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      setInput(transcript)
    }

    recognition.onerror = () => setIsRecording(false)
    recognition.onend = () => setIsRecording(false)

    recognition.start()
    setIsRecording(true)
  }, [isRecording])

  const selectedClaimsCount = currentAnalysis?.claims.filter((c) => c.selected).length ?? 0
  const evidenceCount = currentAnalysis
    ? (currentAnalysis.coreEvidence.length + currentAnalysis.supportingEvidence.length) || currentAnalysis.evidenceChecklist.length
    : 0

  const isEmpty = messages.length === 0 && !isThinking

  const phase: "intent" | "confirm" | "evidence" =
    currentStep === "evidence" || currentAnalysis ? "evidence"
    : currentStep === "confirmation" ? "confirm"
    : "intent"

  const steps = [
    { key: "intent" as const, label: "诉求识别", desc: "AI 分析您的案情" },
    { key: "confirm" as const, label: "用户确认", desc: "确认想主张的诉求" },
    { key: "evidence" as const, label: "证据清单", desc: "生成去律所前的准备材料" },
  ]

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background">
      <header className="shrink-0 flex items-center justify-between border-b border-border px-6 py-3">
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {theme === "dark" ? (
            <SunIcon className="size-4" />
          ) : (
            <MoonIcon className="size-4" />
          )}
        </button>
        <div className="flex items-center gap-2">
          <ScaleIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            AI 法律诉求分析
          </span>
        </div>
        <div className="w-8" />
      </header>

      {/* 三步进度条 */}
      <div className="shrink-0 border-b border-border px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          {steps.map((step, i) => {
            const isActive = phase === step.key
            const isDone = steps.findIndex((s) => s.key === phase) > i
            return (
              <div key={step.key} className="flex flex-1 items-center gap-2">
                <div className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-colors ${
                  isActive ? "bg-primary text-primary-foreground" :
                  isDone ? "bg-primary/30 text-primary" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {isDone ? "✓" : i + 1}
                </div>
                <div className="hidden sm:block min-w-0">
                  <p className={`text-xs font-medium truncate ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                    {step.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 truncate hidden md:block">{step.desc}</p>
                </div>
                {i < steps.length - 1 && (
                  <div className={`mx-1 h-px flex-1 ${isDone ? "bg-primary/30" : "bg-border"}`} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <main className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {isEmpty ? (
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-4 pb-24 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-accent">
                <ScaleIcon className="size-6 text-foreground" />
              </div>
              <h1 className="text-xl font-semibold text-foreground text-center">
                请告诉我您目前的婚姻困境
              </h1>
              <p className="text-center text-sm leading-relaxed text-muted-foreground">
                法律不是婚姻的敌人，而是保护你的战甲。
              </p>
            </div>
          ) : (
            <div
              ref={chatScrollRef}
              onScroll={handleChatScroll}
              className="mx-auto w-full max-w-3xl flex-1 min-h-0 overflow-y-auto px-4 py-6"
            >
              <div className="space-y-6 pr-4">
                {Array.isArray(messages) && messages.map((msg, i) => (
                  <div key={i}>
                    {msg.role === "user" ? (
                      <UserBubble content={msg.content} />
                    ) : msg.analysis ? (
                      <AssistantMessage
                        analysis={msg.analysis}
                        content={msg.content}
                        visibleSections={
                          i === messages.length - 1 ? visibleSections : 5
                        }
                      />
                    ) : (
                      <div className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">
                        {String(msg.content || "")}
                      </div>
                    )}
                  </div>
                ))}
                {isThinking && <ThinkingIndicator currentStep={currentStep} />}
                {currentStep === "discovery" && Array.isArray(questions) && questions.length > 0 && (
                  <div className="space-y-2 rounded-xl border border-border bg-secondary/50 p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <p className="text-xs font-medium text-muted-foreground">我再确认一下，避免遗漏：</p>
                    <ul className="space-y-1.5">
                      {questions.map((q, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-foreground/40" />
                          {String(q)}
                        </li>
                      ))}
                    </ul>
                    {possibleClaims.length > 0 && (
                      <p className="text-[11px] text-muted-foreground/60">如果没有其他了，可以直接说"没有"或"就这些"。</p>
                    )}
                  </div>
                )}
                {currentStep === "confirmation" && !isThinking && Array.isArray(possibleClaims) && possibleClaims.length > 0 && (
                  <>
                    <ClaimSelectionUI
                      claims={possibleClaims}
                      onConfirm={handleConfirmClaims}
                      selectedClaims={selectedClaims}
                      onSelectionChange={setSelectedClaims}
                    />
                    <p className="mt-3 text-center text-xs text-muted-foreground/70">
                      如果还有其他情况需要补充，可以直接在下方聊天框继续输入，我会重新帮你整理可能诉求。
                    </p>
                  </>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}

          <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4 pt-2">
              <div className="relative rounded-2xl border border-border bg-secondary transition-colors focus-within:border-muted-foreground/40">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isEmpty ? "请描述您的婚姻情况，例如：结婚几年、是否有孩子、共同财产、是否长期分居、是否存在家暴等" : "继续输入..."}
                  rows={1}
                  className="w-full resize-none bg-transparent px-4 pt-3.5 pb-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <div className="absolute right-3 bottom-3 flex items-center gap-1.5">
                  <button
                    onClick={toggleRecording}
                    className={`flex size-7 items-center justify-center rounded-lg transition-all ${
                      isRecording
                        ? "animate-pulse bg-destructive text-destructive-foreground"
                        : "bg-foreground/10 text-muted-foreground hover:bg-foreground/15 hover:text-foreground"
                    }`}
                  >
                    {isRecording ? (
                      <SquareIcon className="size-3" />
                    ) : (
                      <MicIcon className="size-3.5" />
                    )}
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!input.trim() || isThinking}
                    className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background transition-opacity disabled:opacity-20"
                  >
                    <ArrowUpIcon className="size-4" />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-center text-[11px] text-muted-foreground/60">
                本工具不会替代律师给出法律结论，只帮助你整理可能诉求，并生成去律所咨询前的证据准备清单。
              </p>
          </div>
        </main>

        {currentAnalysis && (
          <aside className="hidden w-[380px] min-h-0 border-l border-border lg:flex lg:flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="space-y-4 p-4">
                <AnalysisSidebar analysis={currentAnalysis} rawResult={rawAnalysisResult} />
              </div>
            </div>
          </aside>
        )}
      </div>

      {currentAnalysis && (
        <MobilePanel
          analysis={currentAnalysis}
          rawResult={rawAnalysisResult}
          selectedClaimsCount={selectedClaimsCount}
          evidenceCount={evidenceCount}
        />
      )}
    </div>
  )
}

function normalizeEvidenceItem(raw: unknown): { name: string; reason: string } {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const name = String(
    obj.item || obj.title || obj.name || obj.material || obj.evidence_name || ""
  ).trim()
  const reason = String(
    obj.reason || obj.description || obj.purpose || obj.detail || ""
  ).trim()
  return { name, reason }
}

function filterValidEvidence(items: unknown[]): { name: string; reason: string }[] {
  console.log("[filterValidEvidence] raw items:", items)
  const normalized = items.map(normalizeEvidenceItem)
  console.log("[filterValidEvidence] normalized:", normalized)
  const filtered = normalized.filter((e) => e.name !== "")
  console.log("[filterValidEvidence] filtered (non-empty):", filtered)
  return filtered
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-secondary/50"
      >
        <span className="text-[11px] font-medium text-muted-foreground">{title}</span>
        <span className="text-[10px] text-muted-foreground/60">{open ? "收起" : "展开"}</span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

function EvidenceItemCard({
  item,
  checked,
  onToggle,
}: {
  item: CoreEvidenceItem
  checked: boolean
  onToggle: () => void
}) {
  const safe = (v?: string) => v || "—"
  return (
    <div className={`rounded-lg border p-3 transition-opacity ${checked ? "border-border/50 bg-accent/30 opacity-70" : "border-border bg-secondary/30"}`}>
      <div className="flex items-start gap-2.5">
        <Checkbox
          checked={checked}
          onCheckedChange={onToggle}
          className="mt-0.5 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-medium text-foreground/90">
              {safe(item.evidence)}
              {checked && <span className="ml-2 text-[10px] text-muted-foreground">已准备</span>}
            </span>
            {item.evidence_type && (
              <Badge variant="outline" className="shrink-0 text-[10px]">{safe(item.evidence_type)}</Badge>
            )}
          </div>
          {item.proves && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/60">证明目的：</span>{safe(item.proves)}
            </p>
          )}
          {item.corresponding_fact && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/60">待证事实：</span>{safe(item.corresponding_fact)}
            </p>
          )}
          {item.related_claims && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/60">对应诉求：</span>{safe(item.related_claims)}
            </p>
          )}
          {item.note && (
            <p className="mt-1 rounded bg-accent/50 px-2 py-1 text-[10px] text-muted-foreground">
              {item.note}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function AnalysisSidebar({
  analysis,
  rawResult,
}: {
  analysis: AnalysisResult
  rawResult: Record<string, unknown> | null
}) {
  const raw = rawResult || {}
  const claims = Array.isArray(analysis.claims) ? analysis.claims : []
  const riskNotes = Array.isArray(analysis.risks) ? analysis.risks : []
  const lawyerChecklist = Array.isArray(raw.lawyer_visit_checklist) ? raw.lawyer_visit_checklist : []

  const coreEvidence = Array.isArray(analysis.coreEvidence) ? analysis.coreEvidence : []
  const supportingEvidence = Array.isArray(analysis.supportingEvidence) ? analysis.supportingEvidence : []
  const legalAnalysis = Array.isArray(analysis.legalAnalysis) ? analysis.legalAnalysis : []
  const missingInfo = Array.isArray(analysis.missingInfo) ? analysis.missingInfo : []

  const hasNewEvidence = coreEvidence.length > 0 || supportingEvidence.length > 0
  const hasLegalAnalysis = legalAnalysis.length > 0
  const hasMissingInfo = missingInfo.length > 0

  // 旧结构 fallback
  const priorityEvidence = filterValidEvidence(Array.isArray(raw.priority_evidence) ? raw.priority_evidence : [])
  const generalEvidence = filterValidEvidence(Array.isArray(raw.general_evidence) ? raw.general_evidence : [])
  const missingEvidence = filterValidEvidence(Array.isArray(raw.missing_evidence) ? raw.missing_evidence : [])
  const hasLegacyEvidence = priorityEvidence.length > 0 || generalEvidence.length > 0 || missingEvidence.length > 0
  const hasAnyEvidence = hasNewEvidence || hasLegacyEvidence

  // 证据勾选状态 — 新证据清单到达时自动重置
  const [checkedEvidence, setCheckedEvidence] = useState<Record<string, boolean>>({})
  useEffect(() => {
    setCheckedEvidence({})
  }, [coreEvidence, supportingEvidence])

  const toggleEvidence = (key: string) => {
    setCheckedEvidence((prev) => {
      const next = { ...prev }
      if (next[key]) {
        delete next[key]
      } else {
        next[key] = true
      }
      return next
    })
  }

  const coreChecked = coreEvidence.filter((_, i) => checkedEvidence[`core-${i}`]).length
  const supportingChecked = supportingEvidence.filter((_, i) => checkedEvidence[`supporting-${i}`]).length

  return (
    <div className="space-y-5">
      {/* 案件类型 — 主标题 */}
      <div>
        <p className="mb-1 text-[11px] font-medium text-muted-foreground">案件类型</p>
        <h3 className="text-base font-semibold text-foreground">{String(analysis.caseType || "婚姻家庭纠纷")}</h3>
      </div>

      {/* 已确认诉求 */}
      {claims.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">已确认诉求</p>
          <div className="space-y-1.5">
            {claims.filter((c) => c.selected).map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-md bg-secondary/40 px-3 py-1.5 text-xs text-foreground/80">
                <span className="size-1 shrink-0 rounded-full bg-foreground/40" />
                {String(c.text)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 分析依据 — 可折叠 */}
      {hasLegalAnalysis && (
        <CollapsibleSection title="分析依据">
          <div className="space-y-3">
            {legalAnalysis.map((item, i) => (
              <div key={i} className="rounded-lg border border-border bg-secondary/20 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground/90">{item.legal_relation || "法律关系"}</span>
                  {item.related_claims && (
                    <Badge variant="secondary" className="text-[10px]">{item.related_claims}</Badge>
                  )}
                </div>
                {item.legal_elements && item.legal_elements.length > 0 && (
                  <div className="mt-2">
                    <span className="text-[10px] font-medium text-muted-foreground">法律要件：</span>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {item.legal_elements.map((el, j) => (
                        <span key={j} className="rounded bg-accent/50 px-1.5 py-0.5 text-[10px] text-foreground/70">{el}</span>
                      ))}
                    </div>
                  </div>
                )}
                {item.facts_to_prove && item.facts_to_prove.length > 0 && (
                  <div className="mt-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground">待证事实：</span>
                    <div className="mt-0.5 space-y-0.5">
                      {item.facts_to_prove.map((f, j) => (
                        <p key={j} className="text-[10px] text-foreground/60">• {f}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* 证据清单 */}
      {hasNewEvidence ? (
        <>
          {coreEvidence.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-medium text-muted-foreground">核心证据</p>
                <span className="text-[10px] text-muted-foreground/70">已备 {coreChecked} / {coreEvidence.length}</span>
              </div>
              <div className="space-y-2">
                {coreEvidence.map((item, i) => (
                  <EvidenceItemCard
                    key={`core-${i}-${item.evidence}`}
                    item={item}
                    checked={!!checkedEvidence[`core-${i}`]}
                    onToggle={() => toggleEvidence(`core-${i}`)}
                  />
                ))}
              </div>
            </div>
          )}
          {supportingEvidence.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-medium text-muted-foreground">辅助证据</p>
                <span className="text-[10px] text-muted-foreground/70">已备 {supportingChecked} / {supportingEvidence.length}</span>
              </div>
              <div className="space-y-2">
                {supportingEvidence.map((item, i) => (
                  <EvidenceItemCard
                    key={`supporting-${i}-${item.evidence}`}
                    item={item}
                    checked={!!checkedEvidence[`supporting-${i}`]}
                    onToggle={() => toggleEvidence(`supporting-${i}`)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      ) : hasLegacyEvidence ? (
        <>
          {priorityEvidence.length > 0 && (
            <SectionCard
              title="优先准备"
              badge="必要"
              badgeClass="bg-destructive/10 text-destructive"
              items={priorityEvidence}
              defaultChecked={false}
            />
          )}
          {generalEvidence.length > 0 && (
            <SectionCard
              title="一般准备"
              badge="建议"
              badgeClass="bg-chart-4/10 text-chart-4"
              items={generalEvidence}
              defaultChecked={false}
            />
          )}
          {missingEvidence.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-medium text-muted-foreground">待补充材料</p>
              <div className="space-y-2">
                {missingEvidence.map((e, i) => (
                  <div key={i} className="rounded-lg border border-dashed border-border bg-secondary/30 p-3">
                    <p className="text-xs font-medium text-foreground/80">{e.name || "待补充项"}</p>
                    {e.reason && <p className="mt-1 text-[11px] text-muted-foreground">{e.reason}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
          暂未生成有效证据清单，请重新生成或补充更具体的信息。
        </div>
      )}

      {/* 仍需补充的信息 */}
      {hasMissingInfo && (
        <CollapsibleSection title="仍需补充的信息">
          <div className="space-y-1.5">
            {missingInfo.map((info, i) => (
              <div key={i} className="flex items-start gap-2 rounded-md bg-secondary/30 px-3 py-2">
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-chart-4" />
                <span className="text-[11px] leading-relaxed text-foreground/70">{info}</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* 风险提示 */}
      {riskNotes.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">风险提示</p>
          <div className="space-y-1.5">
            {riskNotes.map((r: string, i: number) => (
              <div key={i} className="flex items-start gap-2 rounded-md bg-chart-4/5 px-3 py-2">
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-chart-4" />
                <span className="text-[11px] leading-relaxed text-foreground/70">{String(r)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 律师咨询清单 */}
      {lawyerChecklist.length > 0 && (
        <LawyerChecklistSection items={lawyerChecklist} />
      )}
    </div>
  )
}

function SectionCard({
  title,
  badge,
  badgeClass,
  items,
  defaultChecked,
}: {
  title: string
  badge: string
  badgeClass: string
  items: unknown[]
  defaultChecked: boolean
}) {
  const [collected, setCollected] = useState<Set<number>>(() => {
    const initial = new Set<number>()
    if (defaultChecked) items.forEach((_, i) => initial.add(i))
    return initial
  })

  const toggle = (i: number) => {
    setCollected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">{title}</p>
        <span className={`inline-flex items-center rounded px-1.5 py-0 text-[10px] font-medium ${badgeClass}`}>
          {badge}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground/60">
          已备 {collected.size}/{items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.map((e: unknown, i: number) => {
          const item = e as Record<string, string | undefined>
          const itemName = String(item.name || item.item || item.text || "")
          const itemReason = String(item.reason || "")
          const isCollected = collected.has(i)
          return (
            <label
              key={i}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors ${
                isCollected ? "border-border/50 bg-accent/50" : "border-border bg-secondary/50 hover:bg-accent"
              }`}
            >
              <Checkbox
                checked={isCollected}
                onCheckedChange={() => toggle(i)}
                className="mt-0.5"
              />
              <div className="flex flex-1 flex-col gap-1">
                <span className={`text-xs font-medium ${isCollected ? "text-muted-foreground line-through" : "text-foreground"}`}>
                  {itemName}
                </span>
                {itemReason && (
                  <span className="text-[11px] leading-relaxed text-muted-foreground">{itemReason}</span>
                )}
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function LawyerChecklistSection({ items }: { items: unknown[] }) {
  const safeItems = Array.isArray(items) ? items : []
  const [checked, setChecked] = useState<Set<number>>(() => new Set())

  const toggle = (i: number) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">律师咨询前建议准备</p>
        <span className="ml-auto text-[10px] text-muted-foreground/60">
          已备 {checked.size}/{safeItems.length}
        </span>
      </div>
      <div className="space-y-2">
        {safeItems.map((tip: unknown, i: number) => {
          const isChecked = checked.has(i)
          return (
            <label
              key={i}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors ${
                isChecked ? "border-border/50 bg-accent/50" : "border-border bg-secondary/50 hover:bg-accent"
              }`}
            >
              <Checkbox
                checked={isChecked}
                onCheckedChange={() => toggle(i)}
                className="mt-0.5"
              />
              <span className={`text-xs ${isChecked ? "text-muted-foreground line-through" : "text-foreground"}`}>
                {String(tip)}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function MobilePanel({
  analysis,
  rawResult,
  selectedClaimsCount,
  evidenceCount,
}: {
  analysis: AnalysisResult
  rawResult: Record<string, unknown> | null
  selectedClaimsCount: number
  evidenceCount: number
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <div className="fixed bottom-20 right-4 flex gap-2 lg:hidden">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground shadow-sm"
        >
          <FileCheckIcon className="size-3.5" />
          查看分析报告
        </button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background lg:hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-medium text-foreground">分析报告</span>
        <button
          onClick={() => setOpen(false)}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-4">
          <AnalysisSidebar analysis={analysis} rawResult={rawResult} />
        </div>
      </div>
    </div>
  )
}

function ClaimsPanel({ claims, onToggle }: { claims: Claim[]; onToggle: (id: string) => void }) {
  const safeClaims = Array.isArray(claims) ? claims : []
  const categories = [...new Set(safeClaims.map((c) => c.category))]

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          选择您想要主张的诉求
        </p>
        <Badge variant="secondary" className="text-[10px]">
          已选 {safeClaims.filter((c) => c.selected).length}/{safeClaims.length}
        </Badge>
      </div>
      {categories.map((category) => (
        <div key={category}>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            {category}
          </p>
          <div className="space-y-2">
            {safeClaims
              .filter((c) => c.category === category)
              .map((claim) => (
                <label
                  key={claim.id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-secondary/50 p-3 transition-colors hover:bg-accent"
                >
                  <Checkbox
                    checked={claim.selected}
                    onCheckedChange={() => onToggle(claim.id)}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-foreground">{String(claim.text)}</span>
                </label>
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function EvidencePanel({ items, onToggle }: { items: EvidenceItem[]; onToggle: (id: string) => void }) {
  const safeItems = Array.isArray(items) ? items : []
  const categories = [...new Set(safeItems.map((e) => e.category))]
  const priorityColors: Record<string, string> = {
    high: "bg-destructive",
    medium: "bg-chart-4",
    low: "bg-muted-foreground/40",
  }
  const priorityLabels: Record<string, string> = {
    high: "必要",
    medium: "重要",
    low: "辅助",
  }

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          标记已收集的证据材料
        </p>
        <Badge variant="secondary" className="text-[10px]">
          {safeItems.filter((e) => e.collected).length}/{safeItems.length} 已收集
        </Badge>
      </div>
      {categories.map((category) => (
        <div key={category}>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            {category}
          </p>
          <div className="space-y-2">
            {safeItems
              .filter((e) => e.category === category)
              .map((item) => (
                <label
                  key={item.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    item.collected
                      ? "border-border/50 bg-accent/50"
                      : "border-border bg-secondary/50 hover:bg-accent"
                  }`}
                >
                  <Checkbox
                    checked={item.collected}
                    onCheckedChange={() => onToggle(item.id)}
                    className="mt-0.5"
                  />
                  <div className="flex flex-1 flex-col gap-1">
                    <span className={`text-sm ${item.collected ? "text-muted-foreground line-through" : "text-foreground"}`}>
                      {String(item.text)}
                    </span>
                  </div>
                  <span className={`mt-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    item.priority === "high"
                      ? "bg-destructive/10 text-destructive"
                      : item.priority === "medium"
                      ? "bg-chart-4/10 text-chart-4"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    <span className={`size-1 rounded-full ${priorityColors[item.priority]}`} />
                    {priorityLabels[item.priority]}
                  </span>
                </label>
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground">
        {content}
      </div>
    </div>
  )
}

function AssistantMessage({
  analysis,
  content,
  visibleSections,
}: {
  analysis: AnalysisResult
  content: string
  visibleSections: number
}) {
  const keyFacts = Array.isArray(analysis.keyFacts) ? analysis.keyFacts : []
  const claims = Array.isArray(analysis.claims) ? analysis.claims : []
  const evidenceChecklist = Array.isArray(analysis.evidenceChecklist) ? analysis.evidenceChecklist : []
  const coreEvidence = Array.isArray(analysis.coreEvidence) ? analysis.coreEvidence : []
  const supportingEvidence = Array.isArray(analysis.supportingEvidence) ? analysis.supportingEvidence : []
  const risks = Array.isArray(analysis.risks) ? analysis.risks : []
  const hasNewEvidence = coreEvidence.length > 0 || supportingEvidence.length > 0
  const totalEvidence = hasNewEvidence ? coreEvidence.length + supportingEvidence.length : evidenceChecklist.length
  const topEvidenceItems = hasNewEvidence
    ? coreEvidence.slice(0, 3).map(e => e.evidence)
    : evidenceChecklist.filter((e) => e.priority === "high").slice(0, 3).map(e => e.text)

  const sections = [
    {
      label: "案件类型",
      content: (
        <Badge variant="outline" className="text-xs">{String(analysis.caseType || "未知")}</Badge>
      ),
    },
    {
      label: "关键事实",
      content: (
        <div className="flex flex-wrap gap-1.5">
          {keyFacts.map((f) => (
            <Badge key={String(f)} variant="secondary" className="text-xs">{String(f)}</Badge>
          ))}
        </div>
      ),
    },
    {
      label: "已确认诉求",
      content: (
        <div className="space-y-1.5">
          {claims.filter((c) => c.selected).slice(0, 3).map((c) => (
            <div key={c.id} className="flex items-start gap-2 text-sm text-foreground/80">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-foreground/40" />
              {String(c.text)}
            </div>
          ))}
          {claims.filter((c) => c.selected).length > 3 && (
            <span className="text-xs text-muted-foreground">
              等 {claims.filter((c) => c.selected).length} 项诉求（详见右侧报告）
            </span>
          )}
        </div>
      ),
    },
    {
      label: "证据清单",
      content: totalEvidence > 0 ? (
        <div className="space-y-1.5">
          {topEvidenceItems.map((text, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-foreground/80">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-destructive" />
              {String(text)}
            </div>
          ))}
          <span className="text-xs text-muted-foreground">
            {hasNewEvidence && (
              <span>核心 {coreEvidence.length} 项 + 辅助 {supportingEvidence.length} 项（详见右侧报告）</span>
            )}
            {!hasNewEvidence && (
              <span>共 {evidenceChecklist.length} 项（详见右侧报告）</span>
            )}
          </span>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">暂无</div>
      ),
    },
    {
      label: "风险提示",
      content: (
        <ul className="space-y-1">
          {risks.map((r) => (
            <li key={String(r)} className="flex items-start gap-2 text-sm text-foreground/60">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-chart-4" />
              {String(r)}
            </li>
          ))}
        </ul>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {content ? (
        <div className="text-sm leading-relaxed text-foreground/80">{content}</div>
      ) : null}
      {sections.map(
        (section, i) =>
          i < visibleSections && (
            <div
              key={section.label}
              className="animate-in fade-in slide-in-from-bottom-2 duration-400"
            >
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                {section.label}
              </p>
              {section.content}
            </div>
          )
      )}
    </div>
  )
}

function ClaimSelectionUI({
  claims,
  onConfirm,
  selectedClaims,
  onSelectionChange,
}: {
  claims: Array<{ claim: string; confidence: string; reason: string }>
  onConfirm: (selected: string[]) => void
  selectedClaims: Set<string>
  onSelectionChange: (next: Set<string>) => void
}) {
  const safeClaims = Array.isArray(claims) ? claims : []
  const validClaims = safeClaims.filter(isValidClaim)

  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectedClaims))

  // parent → child: 当 possibleClaims 变化时（合并/过滤），清理已不存在的选中项
  useEffect(() => {
    const currentClaimTexts = new Set(validClaims.map((c) => c.claim))
    setSelected((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const c of prev) {
        if (!currentClaimTexts.has(c)) { next.delete(c); changed = true }
      }
      return changed ? next : prev
    })
  }, [validClaims])

  // child → parent: 用户勾选/取消后同步到父组件 selectedClaims
  useEffect(() => {
    onSelectionChange(selected)
  }, [selected, onSelectionChange])

  const toggle = (claimText: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(claimText)) next.delete(claimText)
      else next.add(claimText)
      return next
    })
  }

  const confidenceBadge = (confidence: string) => {
    const variants: Record<string, string> = {
      high: "bg-primary/10 text-primary",
      medium: "bg-chart-4/10 text-chart-4",
      low: "bg-muted text-muted-foreground",
    }
    const labels: Record<string, string> = {
      high: "明确",
      medium: "可能涉及",
      low: "待确认",
    }
    return (
      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${variants[confidence] || variants.medium}`}>
        {labels[confidence] || confidence}
      </span>
    )
  }

  if (validClaims.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-secondary/50 p-4 text-sm text-muted-foreground">
        无法解析诉求列表，请重试。
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-secondary/50 p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <p className="text-xs font-medium text-muted-foreground">请确认您想主张的诉求：</p>
      <div className="space-y-2">
        {validClaims.map((item, i) => (
          <label key={i} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-3 transition-colors hover:bg-accent">
            <Checkbox
              checked={selected.has(item.claim)}
              onCheckedChange={() => toggle(item.claim)}
              className="mt-0.5"
            />
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground">{String(item.claim)}</span>
                {confidenceBadge(item.confidence)}
              </div>
              {item.reason && (
                <span className="text-xs text-muted-foreground">{String(item.reason)}</span>
              )}
            </div>
          </label>
        ))}
      </div>
      <button
        onClick={() => onConfirm(Array.from(selected))}
        disabled={selected.size === 0}
        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
      >
        {selected.size === 0 ? "请至少选择一个诉求" : "确认诉求并生成证据清单"}
      </button>
    </div>
  )
}

function getLoadingMessage(currentStep: string): string {
  if (currentStep === "confirmation") return "正在根据您补充的信息重新整理诉求..."
  if (currentStep === "evidence") return "正在生成证据清单..."
  return "正在分析案情..."
}

function ThinkingIndicator({ currentStep }: { currentStep: string }) {
  return (
    <div className="flex items-center gap-2 py-2 animate-in fade-in duration-300">
      <div className="flex gap-1">
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/50" style={{ animationDelay: "0ms" }} />
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/50" style={{ animationDelay: "150ms" }} />
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/50" style={{ animationDelay: "300ms" }} />
      </div>
      <span className="text-xs text-muted-foreground/60">{getLoadingMessage(currentStep)}</span>
    </div>
  )
}

export default App
