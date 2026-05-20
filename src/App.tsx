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

interface AnalysisResult {
  caseType: string
  keyFacts: string[]
  claims: Claim[]
  risks: string[]
  evidenceChecklist: EvidenceItem[]
  missingInfo: string[]
}

interface Message {
  role: "user" | "assistant"
  content: string
  analysis?: AnalysisResult
}



const NEGATION_KEYWORDS = [
  "不想", "不要", "不主张", "不处理", "暂时不考虑",
  "不争", "不需要", "不想要", "不打算", "放弃",
  "不要求", "不涉及", "不准备",
]

const KNOWN_CLAIMS = [
  "夫妻共同财产分割", "共同财产分割", "财产分割",
  "子女抚养权", "孩子抚养权", "抚养权",
  "子女抚养费", "孩子抚养费", "抚养费",
  "解除婚姻关系", "离婚",
  "离婚损害赔偿", "损害赔偿",
  "探望权", "探视权",
  "人身安全保护令", "保护令",
  "精神损害赔偿",
  "房产分割",
  "财产",
]

function detectExcludedClaims(userInput: string): string[] {
  const found: string[] = []
  for (const keyword of NEGATION_KEYWORDS) {
    let searchFrom = 0
    while (true) {
      const idx = userInput.indexOf(keyword, searchFrom)
      if (idx === -1) break
      const after = userInput.slice(idx + keyword.length)
      for (const claim of KNOWN_CLAIMS) {
        if (after.includes(claim) && !found.includes(claim)) {
          found.push(claim)
        }
      }
      searchFrom = idx + keyword.length
    }
  }
  // 归一化：如果父名称匹配了，去掉更短的子名称
  return found.filter((c, _i, arr) =>
    !arr.some((other) => other !== c && other.includes(c))
  )
}

// 过于细节的事实追问关键词 — 证据清单阶段才需要
const DETAIL_PATTERNS = [
  /房产/, /存款/, /车辆/, /债务/, /工资/, /收入/, /流水/,
  /谁照顾/, /日常照顾/, /生活安排/, /教育/, /学费/, /学校/,
  /分居.*证据/, /家暴.*证据/, /出轨.*证据/, /证据.*收集/,
  /对方.*收入/, /对方.*财产/, /对方.*工作/, /对方.*名下/,
  /具体.*金额/, /具体.*价值/, /市值/, /评估/,
  /报警.*记录/, /就医.*记录/, /聊天.*记录/, /短信/,
]

function filterAndLimitQuestions(raw: string[], excludedClaims: string[]): string[] {
  // 1. 过滤占位符
  let qs = raw.filter((q) => !/^问题\d+/.test(q) && q.trim().length > 0)

  // 2. 过滤过于细节的事实追问
  qs = qs.filter((q) => !DETAIL_PATTERNS.some((p) => p.test(q)))

  // 3. 已排除的诉求不要再问
  if (excludedClaims.length > 0) {
    qs = qs.filter((q) => !excludedClaims.some((ex) => q.includes(ex)))
  }

  // 4. 去重（相似问题只保留一个）
  const seen = new Set<string>()
  qs = qs.filter((q) => {
    const key = q.slice(0, 6)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // 5. 最多保留 2 个问题
  qs = qs.slice(0, 2)

  return qs
}

// 用户已提及的诉求关键词检测
const MENTION_PATTERNS: { claim: string; label: string; patterns: RegExp[] }[] = [
  { claim: "离婚", label: "离婚", patterns: [/离婚/, /想离/, /过不下去/, /分开/, /解除婚姻/, /离了/] },
  { claim: "抚养权", label: "子女抚养权", patterns: [/抚养权/, /孩子归谁/, /孩子跟谁/, /子女.*谁照顾/, /孩子.*谁带/] },
  { claim: "抚养费", label: "抚养费", patterns: [/抚养费/, /生活费/, /教育费/, /学费/] },
  { claim: "财产分割", label: "财产分割", patterns: [/财产分割/, /房子/, /房产/, /共同财产/, /分财产/, /财产怎么/, /存款/, /车辆/] },
  { claim: "损害赔偿", label: "家暴/出轨赔偿", patterns: [/出轨/, /家暴/, /打我/, /威胁/, /虐待/, /冷暴力/, /婚外情/] },
  { claim: "探望权", label: "探望权", patterns: [/探望/, /探视/, /看孩子/] },
]

// 所有可能的追问方向
const FOLLOW_UP_DIRECTIONS = [
  { claim: "离婚", phrase: "离婚本身" },
  { claim: "抚养权", phrase: "子女抚养权归属" },
  { claim: "抚养费", phrase: "子女抚养费" },
  { claim: "财产分割", phrase: "夫妻财产/房产/存款分割" },
  { claim: "损害赔偿", phrase: "家暴或出轨的损害赔偿" },
  { claim: "探望权", phrase: "子女探望安排" },
]

// 追问方向 → 排除时对应的 claim 名称
const TOPIC_TO_EXCLUDED_CLAIMS: Record<string, string[]> = {
  "抚养权": ["子女抚养权", "抚养权", "孩子抚养权"],
  "探望权": ["探望权", "探视权"],
  "抚养费": ["子女抚养费", "抚养费", "孩子抚养费"],
  "财产分割": ["财产分割", "夫妻共同财产分割", "房产分割"],
  "损害赔偿": ["离婚损害赔偿", "损害赔偿", "人身安全保护令"],
}

// 用户输入中是否表达了离婚/分开意图
const DIVORCE_INTENT_PATTERNS = [
  /我想离婚/, /想离婚/, /我要离婚/, /我想离/, /想离/,
  /想分开/, /过不下去/, /感情不和/, /婚姻.*继续/,
  /不想过了/, /不想继续/, /婚姻.*破裂/, /过不下去/,
  /分开/, /离婚/, /离了/,
]

function detectDivorceIntent(accumulatedText: string): boolean {
  return DIVORCE_INTENT_PATTERNS.some((p) => p.test(accumulatedText))
}

function ensureBaseDivorceClaim(
  existingClaims: Array<{ claim: string; confidence: string; reason: string }>,
  hasDivorceIntent: boolean,
): Array<{ claim: string; confidence: string; reason: string }> {
  if (!hasDivorceIntent) return existingClaims
  const hasDivorceClaim = existingClaims.some(
    (c) => c.claim.includes("离婚") || c.claim.includes("解除婚姻")
  )
  if (hasDivorceClaim) return existingClaims
  return [
    { claim: "离婚", confidence: "medium", reason: "用户表达婚姻关系难以继续或有离婚意愿" },
    ...existingClaims,
  ]
}

// 第一轮低信息输入检测 — 模糊意图、情绪宣泄、缺具体事实
const LOW_INFO_DIVORCE_PATTERNS = [
  /^我想离婚[。.]*$/, /^我想分开[。.]*$/, /^我想离[。.]*$/,
  /^想离婚[。.]*$/, /^想离[。.]*$/, /^我要离婚[。.]*$/, /^我要离[。.]*$/,
  /^过不下去/, /^想离开/, /^想跟他/, /^想跟她/,
  /^不想过了[。.]*$/, /^不想跟他过了[。.]*$/, /^不想跟她过了[。.]*$/,
  /^想结束.*婚姻/, /^婚姻.*走不下去/,
  /^感情不和/, /^我不想继续/,
]
const CONCRETE_FACT_PATTERNS = [
  /子女/, /孩子/, /小孩/, /儿子/, /女儿/,
  /财产/, /出轨/, /家暴/, /债务/, /抚养/,
  /房产/, /房子/, /存款/, /工资/, /收入/,
  /暴力/, /虐待/, /动手/, /打了/, /威胁/,
  /小三/, /第三者/, /婚外情/, /冷暴力/,
  /赔偿/, /探望/, /探视/,
]

// 强情绪关键词 — 情绪宣泄但缺乏法律事实
const EMOTION_KEYWORDS = [
  "好难过", "难过", "受不了", "受够了", "撑不住", "撑不下去",
  "过不下去", "不想活", "痛苦", "崩溃",
  "不知道怎么办", "不知道该怎么办", "不知道要怎么", "不知道该怎么",
  "想逃离", "想逃", "想离开", "想分开",
  "真的很累", "好累", "心累",
  "绝望", "无助", "折磨",
]

const LEGAL_FACT_KEYWORDS = [
  "离婚", "孩子", "子女", "抚养权", "抚养费",
  "房产", "财产", "债务", "出轨", "家暴",
  "分居", "结婚", "领证", "暴力", "虐待",
  "第三者", "婚外情", "赔偿", "探望", "探视",
]

function detectEmotionLowInfo(userInput: string): boolean {
  const hasEmotion = EMOTION_KEYWORDS.some((kw) => userInput.includes(kw))
  const hasLegalFact = LEGAL_FACT_KEYWORDS.some((kw) => userInput.includes(kw))
  return hasEmotion && !hasLegalFact
}

function getLowInfoGuidanceMessage(): string {
  return "我理解你现在可能正处在很痛苦、很混乱的状态。没关系，我们先不用急着下结论，也不用一次把所有事情说完整。\n\n你可以慢慢告诉我：这段婚姻里最让你想离开的原因是什么？比如感情不和、长期分居、孩子问题、财产问题、出轨、家暴，或其他让你难以承受的情况。\n\n我会根据你补充的信息，帮你整理可能涉及的诉求，并生成去律所咨询前可以准备的材料清单。"
}

function detectMentionedClaims(fullUserText: string): string[] {
  const found: string[] = []
  for (const { claim, patterns } of MENTION_PATTERNS) {
    if (patterns.some((p) => p.test(fullUserText))) {
      found.push(claim)
    }
  }
  return found
}

function buildSmartFollowUp(
  accumulatedText: string,
  possibleClaimsRaw: Array<{ claim: string }>,
  excludedClaims: string[],
  allowNoMoreSuggestion: boolean,
): { questions: string[]; topics: string[] } {
  // 1. 从用户输入检测已提及的诉求
  const mentionedFromInput = detectMentionedClaims(accumulatedText)

  // 2. 从 possibleClaims 提取已识别的诉求名
  const identifiedFromClaims = (possibleClaimsRaw || []).map((c) => {
    for (const { claim, patterns } of MENTION_PATTERNS) {
      if (patterns.some((p) => p.test(c.claim))) return claim
    }
    return ""
  }).filter(Boolean)

  // 3. 合并：已覆盖的诉求
  const covered = [...new Set([...mentionedFromInput, ...identifiedFromClaims])]
  console.log("[buildSmartFollowUp] recognizedClaimNames:", covered)
  console.log("[buildSmartFollowUp] excludedClaims:", excludedClaims)

  // 4. 未覆盖的追问方向（排除已覆盖 + 已排除）
  const followUpCandidatesBefore = FOLLOW_UP_DIRECTIONS.filter(
    (d) => !covered.includes(d.claim)
  )
  console.log("[buildSmartFollowUp] followUpCandidatesBeforeFilter:", followUpCandidatesBefore.map(d => d.phrase))

  const candidates = followUpCandidatesBefore.filter(
    (d) => !excludedClaims.some((ex) => d.phrase.includes(ex) || ex.includes(d.phrase))
  )
  console.log("[buildSmartFollowUp] followUpCandidatesAfterFilter:", candidates.map(d => d.phrase))

  // 5. 没有未覆盖的方向 → 空
  if (candidates.length === 0) return { questions: [], topics: [] }

  // 6. 没有已覆盖的诉求 → 不生成"婚姻问题"兜底追问，返回空
  if (covered.length === 0) {
    console.log("[buildSmartFollowUp] covered is empty, skip vague follow-up")
    return { questions: [], topics: [] }
  }

  const coveredLabels = covered
    .map((c) => MENTION_PATTERNS.find((m) => m.claim === c)?.label || c)
    .filter(Boolean)
  const coveredText = coveredLabels.join("、")
  const candidatePhrases = candidates.slice(0, 2).map((d) => d.phrase)
  const candidateText = candidatePhrases.join("、")

  const askedTopics = candidates.slice(0, 2).map((d) => d.claim)
  const noMoreHint = allowNoMoreSuggestion ? "如果没有，可以直接说\"没有\"。" : ""
  const question = `我理解您目前主要想处理的是【${coveredText}】。为了避免遗漏，除了这些之外，是否还涉及【${candidateText}】？${noMoreHint}`

  console.log("[buildSmartFollowUp] finalFollowUpQuestion:", question)
  console.log("[buildSmartFollowUp] lastFollowUpTopics:", askedTopics)
  return { questions: [question], topics: askedTopics }
}

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
  const lastFollowUpQuestionRef = useRef<string>("")
  const lastFollowUpTopicsRef = useRef<string[]>([])
  const lastQueryRef = useRef<string>("")
  const wasFirstTurnLowInfoRef = useRef(false)

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
    console.log("[callAnalysisApi] request body:", { query, confirmed_claims: confirmedClaims })
    const response = await fetch("/api/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, confirmed_claims: confirmedClaims, user: "demo-user" }),
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      throw new Error(errorData?.error || errorData?.detail || `HTTP ${response.status}`)
    }
    const data = await response.json()
    console.log("[callAnalysisApi] raw response data:", data)
    if (data.error) { throw new Error(data.error) }
    return data.result
  }

  const handleSubmit = async () => {
    console.log("[handleSubmit] called, input:", JSON.stringify(input), "isThinking:", isThinking, "currentStep:", currentStep)
    // 防御性恢复：如果 isThinking 异常卡在 true，先重置再继续
    if (isThinking) {
      console.log("[handleSubmit] WARNING: isThinking was stuck at true, resetting to false")
      setIsThinking(false)
    }
    if (!input.trim()) {
      console.log("[handleSubmit] BLOCKED — input empty")
      return
    }

    const userContent = input.trim()

    // 检测本轮否定表达（在任何其他处理之前）
    const newlyExcluded = detectExcludedClaims(userContent)

    const noMorePattern = /^(没有|没了|无|暂时没有|没有其他|就这些|就这个|只要这个|只想离婚|不涉及其他|就这样|没有了|没啥了|差不多了|就没了|只要.*就行|仅.*即可)$/
    const isNoMore = noMorePattern.test(userContent)

    // 第一轮低信息输入统一检测
    const isFirstTurn = messages.length === 0
    const hasConcreteFacts = CONCRETE_FACT_PATTERNS.some((p) => p.test(userContent))
    const matchesDivorcePattern = LOW_INFO_DIVORCE_PATTERNS.some((p) => p.test(userContent))
    const isEmotionLowInfoInput = detectEmotionLowInfo(userContent)
    const isFirstTurnLowInfo = isFirstTurn && (matchesDivorcePattern || isEmotionLowInfoInput) && !hasConcreteFacts
    const shouldAllowNoMoreClaims = possibleClaims.length > 0
    const hasConcreteLegalFacts = hasConcreteFacts || LEGAL_FACT_KEYWORDS.some((kw) => userContent.includes(kw))

    console.log("[handleSubmit] latestUserInput:", userContent)
    console.log("[handleSubmit] isThinking before:", isThinking)
    console.log("[handleSubmit] isFirstTurn:", isFirstTurn)
    console.log("[handleSubmit] isEmotionLowInfoInput:", isEmotionLowInfoInput)
    console.log("[handleSubmit] isLowInfoDivorceInput:", matchesDivorcePattern)
    console.log("[handleSubmit] hasConcreteFacts:", hasConcreteFacts)
    console.log("[handleSubmit] possibleClaims.length:", possibleClaims.length)
    console.log("[handleSubmit] shouldCallDify:", !isFirstTurnLowInfo)
    console.log("[handleSubmit] shouldAllowNoMoreClaims:", shouldAllowNoMoreClaims)
    console.log("[handleSubmit] branch selected:", isFirstTurnLowInfo ? "lowInfoGuidance" : "normal")

    // ── 第一轮低信息输入 → 统一情绪承接 + 引导，不调 Dify ──
    if (isFirstTurnLowInfo) {
      console.log("[handleSubmit] selectedTemplateName: getLowInfoGuidanceMessage")
      console.log("[handleSubmit] branch: lowInfoGuidance — NO Dify call")
      wasFirstTurnLowInfoRef.current = true
      const updatedCase = [...caseDescription, userContent]
      setCaseDescription(updatedCase)

      const userMessage: Message = { role: "user", content: userContent }
      setMessages((prev) => [...prev, userMessage])
      setInput("")
      setIsThinking(false)
      setVisibleSections(0)

      const followUpMsg = getLowInfoGuidanceMessage()
      console.log("[handleSubmit] generatedAssistantMessage:", followUpMsg.slice(0, 60) + "...")
      console.log("[handleSubmit] accumulatedUserInput:", JSON.stringify(updatedCase))
      const assistantMessage: Message = { role: "assistant", content: followUpMsg }
      setMessages((prev) => [...prev, assistantMessage])
      console.log("[handleSubmit] isThinking after branch:", false)
      return
    }

    // "没有"/"不涉及"类回复不追加到案情上下文
    const updatedCase = (isNoMore || isTopicNegation) && newlyExcluded.length === 0
      ? caseDescription
      : [...caseDescription, userContent]
    setCaseDescription(updatedCase)
    const updatedExcluded = [...excludedClaims]
    for (const c of newlyExcluded) {
      if (!updatedExcluded.includes(c)) updatedExcluded.push(c)
    }

    console.log("[handleSubmit] ===== 状态机 =====")
    console.log("[handleSubmit] currentStep:", currentStep)
    console.log("[handleSubmit] latestUserInput:", userContent)
    console.log("[handleSubmit] accumulatedUserInput:", JSON.stringify(updatedCase))
    console.log("[handleSubmit] detectedExcludedClaims:", newlyExcluded)
    console.log("[handleSubmit] excludedClaims:", updatedExcluded)

    const userMessage: Message = { role: "user", content: userContent }
    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setVisibleSections(0)

    // 检测是否针对上一轮追问的定向否定（"不涉及"/"没有这方面" 等）
    const topicNegationPattern = /^(不涉及|不处理|不需要|不考虑|不想要|不主张|不要求|没有这方面|没有这个|没有这方|不涉及这个|不涉及这方面|没有相关|暂无这方面)$/
    const isTopicNegation = topicNegationPattern.test(userContent)
    const detectedNoOrNotInvolved = isNoMore || isTopicNegation
    const hasLastTopics = lastFollowUpTopicsRef.current.length > 0

    console.log("[handleSubmit] latestUserInput:", userContent)
    console.log("[handleSubmit] lastFollowUpTopics:", lastFollowUpTopicsRef.current)
    console.log("[handleSubmit] detectedNoOrNotInvolved:", detectedNoOrNotInvolved)
    console.log("[handleSubmit] excludedClaims:", updatedExcluded)
    console.log("[handleSubmit] accumulatedUserInput:", JSON.stringify(caseDescription))
    console.log("[handleSubmit] isNoMoreClaims:", isNoMore)
    console.log("[handleSubmit] currentPossibleClaims:", possibleClaims.map(c => c.claim))
    console.log("[handleSubmit] currentStep before:", currentStep)

    // ── 用户表示"没有更多" → 不再追问 ──
    if (isNoMore && newlyExcluded.length === 0) {
      if (possibleClaims.length > 0) {
        // 有已识别诉求 → 直接进入 confirmation
        setCurrentStep("confirmation")
        setQuestions([])
        setCaseDescription([])
        lastFollowUpTopicsRef.current = []
        console.log("[handleSubmit] currentStep after: confirmation (no more, has claims)")
        const assistantMessage: Message = {
          role: "assistant",
          content: "好的，我已整理出以下诉求，请确认您想主张的内容：",
        }
        setMessages((prev) => [...prev, assistantMessage])
        return
      }
      // 第一轮低信息后第二轮说"没有" → 引导不要放弃
      if (wasFirstTurnLowInfoRef.current && possibleClaims.length === 0) {
        console.log("[handleSubmit] generatedFollowUpMessage (secondTurnNoMoreAfterLowInfo): blocking")
        const assistantMessage: Message = {
          role: "assistant",
          content: `我理解您现在可能还不方便展开。仅凭"想离婚"还不足以整理完整诉求。您可以先从一个方面说起：原因、孩子、财产，或者对方是否同意离婚。`,
        }
        setMessages((prev) => [...prev, assistantMessage])
        return
      }
      // discovery 阶段说"没有"且无 claims，但有 lastFollowUpTopics → 定向排除
      if (hasLastTopics && currentStep === "discovery") {
        const topicsToExclude: string[] = []
        for (const topic of lastFollowUpTopicsRef.current) {
          const mapped = TOPIC_TO_EXCLUDED_CLAIMS[topic]
          if (mapped) topicsToExclude.push(...mapped)
        }
        const mergedExcluded = [...updatedExcluded]
        for (const c of topicsToExclude) {
          if (!mergedExcluded.includes(c)) mergedExcluded.push(c)
        }
        console.log("[handleSubmit] topicsToExclude from lastFollowUpTopics:", topicsToExclude)
        console.log("[handleSubmit] mergedExcluded:", mergedExcluded)

        const accumulatedForDivorce = [...caseDescription, userContent].join(" ")
        const hasDivorceIntent = detectDivorceIntent(accumulatedForDivorce)
        const ensuredClaims = ensureBaseDivorceClaim(possibleClaims, hasDivorceIntent)
        const filtered = ensuredClaims.filter(
          (c) => !mergedExcluded.some((ex) => c.claim.includes(ex) || ex.includes(c.claim))
        )

        console.log("[handleSubmit] hasDivorceIntent:", hasDivorceIntent)
        console.log("[handleSubmit] ensuredBaseClaims:", ensuredClaims.map(c => c.claim))
        console.log("[handleSubmit] possibleClaims after filtering:", filtered.map(c => c.claim))

        if (filtered.length > 0) {
          setPossibleClaims(filtered)
          setExcludedClaims(mergedExcluded)
          setCaseDescription([])
          setQuestions([])
          lastFollowUpTopicsRef.current = []
          setCurrentStep("confirmation")
          const assistantMessage: Message = {
            role: "assistant",
            content: "好的，我已根据您的回复整理出以下诉求，请确认：",
          }
          setMessages((prev) => [...prev, assistantMessage])
          return
        }
      }
      if (currentStep === "confirmation") {
        // 在 confirmation 阶段说"没有"且 possibleClaims 为空（都被排除了）
        const assistantMessage: Message = {
          role: "assistant",
          content: "我目前还没有识别出明确诉求。您可以补充一句，例如：我想离婚 / 想要抚养权 / 有财产纠纷。",
        }
        setMessages((prev) => [...prev, assistantMessage])
        return
      }
      // discovery 阶段说"没有"且无 claims → 给引导提示
      const assistantMessage: Message = {
        role: "assistant",
        content: "我目前还没有识别出明确诉求。您可以补充一句，例如：我想离婚 / 想要抚养权 / 有财产纠纷。",
      }
      setMessages((prev) => [...prev, assistantMessage])
      return
    }

    // ── 定向否定：用户针对上一轮追问回复"不涉及" ──
    if (isTopicNegation && !isNoMore && newlyExcluded.length === 0 && hasLastTopics && currentStep === "discovery") {
      const topicsToExclude: string[] = []
      for (const topic of lastFollowUpTopicsRef.current) {
        const mapped = TOPIC_TO_EXCLUDED_CLAIMS[topic]
        if (mapped) topicsToExclude.push(...mapped)
      }
      const mergedExcluded = [...updatedExcluded]
      for (const c of topicsToExclude) {
        if (!mergedExcluded.includes(c)) mergedExcluded.push(c)
      }
      console.log("[handleSubmit] topicNegation — topicsToExclude:", topicsToExclude)
      console.log("[handleSubmit] topicNegation — mergedExcluded:", mergedExcluded)

      const accumulatedForIntent = [...caseDescription, userContent].join(" ")
      const hasDivorceIntent = detectDivorceIntent(accumulatedForIntent)
      const ensuredClaims = ensureBaseDivorceClaim(possibleClaims, hasDivorceIntent)
      const filtered = ensuredClaims.filter(
        (c) => !mergedExcluded.some((ex) => c.claim.includes(ex) || ex.includes(c.claim))
      )

      console.log("[handleSubmit] hasDivorceIntent:", hasDivorceIntent)
      console.log("[handleSubmit] ensuredBaseClaims:", ensuredClaims.map(c => c.claim))
      console.log("[handleSubmit] possibleClaims after filtering:", filtered.map(c => c.claim))
      console.log("[handleSubmit] currentStep:", filtered.length > 0 ? "confirmation" : "discovery")

      if (filtered.length > 0) {
        setPossibleClaims(filtered)
        setExcludedClaims(mergedExcluded)
        setCaseDescription([])
        setQuestions([])
        lastFollowUpTopicsRef.current = []
        setCurrentStep("confirmation")
        const assistantMessage: Message = {
          role: "assistant",
          content: "已收到您的反馈。当前可主张的诉求已更新，请确认：",
        }
        setMessages((prev) => [...prev, assistantMessage])
        return
      }

      // filtered 为空但用户表达了离婚意图且没有 → 不应发生，但保留兜底
      setExcludedClaims(mergedExcluded)
      setCaseDescription([])
      setQuestions([])
      lastFollowUpTopicsRef.current = []
      const assistantMessage: Message = {
        role: "assistant",
        content: "我目前还没有识别出明确诉求，请补充是否涉及离婚、子女、财产、出轨或家暴。",
      }
      setMessages((prev) => [...prev, assistantMessage])
      return
    }

    // ── confirmation 阶段：本地处理否定 + 补充事实重调 Intent Discovery ──
    if (currentStep === "confirmation") {
      if (newlyExcluded.length > 0) {
        setExcludedClaims(updatedExcluded)
        const filtered = possibleClaims.filter(
          (c) => !updatedExcluded.some((ex) => c.claim.includes(ex) || ex.includes(c.claim))
        )
        // 同步清理 selectedClaims 中已排除的诉求
        setSelectedClaims((prev) => {
          const next = new Set(prev)
          for (const c of prev) {
            if (updatedExcluded.some((ex) => c.includes(ex) || ex.includes(c))) {
              next.delete(c)
            }
          }
          return next
        })
        console.log("[handleSubmit] possibleClaims before filter:", possibleClaims.map(c => c.claim))
        console.log("[handleSubmit] possibleClaims after filter:", filtered.map(c => c.claim))

        if (filtered.length > 0) {
          setPossibleClaims(filtered)
          const assistantMessage: Message = {
            role: "assistant",
            content: `已收到您的排除信息。当前可主张的诉求已更新，请确认：`,
          }
          setMessages((prev) => [...prev, assistantMessage])
        } else {
          setPossibleClaims([])
          setSelectedClaims(new Set())
          const assistantMessage: Message = {
            role: "assistant",
            content: "我还没有识别出明确诉求，请补充是否涉及离婚、子女、财产、出轨或家暴。",
          }
          setMessages((prev) => [...prev, assistantMessage])
        }
        return
      }

      // 没有否定词 → 用户补充新事实，重新调用 Intent Discovery
      // 继续往下走到 discovery 逻辑
    }

    // ── discovery 阶段（或 confirmation 阶段补充事实）──
    setIsThinking(true)
    console.log("[handleSubmit] isThinking after branch: true (calling Dify)")
    setQuestions([])

    // 构建完整上下文
    const baseQuery: string = updatedCase.map((line, i) => `${i + 1}. ${String(line)}`).join("\n") || userContent
    console.log("[handleSubmit] accumulatedUserInput:", JSON.stringify(updatedCase))
    let fullQuery = baseQuery
    if (updatedExcluded.length > 0) {
      fullQuery += `\n\n用户已明确排除的诉求：\n${updatedExcluded.map((c) => `- ${c}`).join("\n")}`
    }
    if (isNoMore) {
      fullQuery += "\n\n用户表示没有更多补充了，请直接基于已有信息生成 possible_claims，不要再追问。"
    }
    lastQueryRef.current = fullQuery

    console.log("[handleSubmit] fullQuery:", fullQuery)
    console.log("[handleSubmit] called: Intent Discovery App → /api/intent")

    try {
      const result = await callIntentApi(fullQuery)
      console.log("[handleSubmit] raw possible_claims:", result?.possible_claims)

      // 智能追问：基于已提及诉求 + 已排除，动态生成
      if (result?.status === "need_more_info") {
        const rawQuestions: string[] = Array.isArray(result.questions) ? result.questions : []

        // 用 Dify possible_claims（可能为空）跑智能追问
        const difyClaims = Array.isArray(result.possible_claims) ? result.possible_claims : []
        const accumulatedText = updatedCase.join(" ")
        const { questions: smartQuestions, topics: smartTopics } = buildSmartFollowUp(accumulatedText, difyClaims, updatedExcluded, shouldAllowNoMoreClaims || difyClaims.length > 0)

        // 智能追问为空时，fallback 到过滤后的 Dify 原始问题
        let finalQuestions = smartQuestions.length > 0
          ? smartQuestions
          : filterAndLimitQuestions(rawQuestions, updatedExcluded)
        let finalTopics = smartQuestions.length > 0 ? smartTopics : []

        console.log("[handleSubmit] generatedFollowUpMessage:", finalQuestions)

        // 去重：和上一轮追问相同 → 不再追问
        const lastFQ = lastFollowUpQuestionRef.current
        const isDuplicateFQ = lastFQ && finalQuestions.length === 1 && finalQuestions[0] === lastFQ
        console.log("[handleSubmit] lastFollowUpQuestion:", lastFQ)
        console.log("[handleSubmit] isDuplicateFollowUp:", isDuplicateFQ)

        if (isDuplicateFQ) {
          // 追问重复 → 尝试直接从 Dify possible_claims 进入 confirmation
          if (difyClaims.length > 0) {
            const filteredClaims = difyClaims.filter(
              (c: { claim: string }) => !updatedExcluded.some((ex) =>
                c.claim.includes(ex) || ex.includes(c.claim)
              )
            )
            if (filteredClaims.length > 0) {
              setPossibleClaims(filteredClaims)
              setExcludedClaims(updatedExcluded)
              setCaseDescription([])
              setQuestions([])
              setCurrentStep("confirmation")
              console.log("[handleSubmit] currentStep after: confirmation (duplicate FQ, has claims)")
              const assistantMessage: Message = {
                role: "assistant",
                content: "根据您的描述，我整理出以下诉求，请确认：",
              }
              setMessages((prev) => [...prev, assistantMessage])
              setIsThinking(false)
              return
            }
          }
          finalQuestions = []
          finalTopics = []
        }

        // 记录本轮的追问
        if (finalQuestions.length === 1) {
          lastFollowUpQuestionRef.current = finalQuestions[0]
        } else if (finalQuestions.length === 0) {
          lastFollowUpQuestionRef.current = ""
        }
        lastFollowUpTopicsRef.current = finalTopics

        setQuestions(finalQuestions)
        const hasRecognizedClaims = possibleClaims.length > 0 || difyClaims.length > 0
        const recognizedClaimNames = [
          ...possibleClaims.map(c => c.claim),
          ...difyClaims.map((c: { claim: string }) => c.claim),
        ]
        console.log("[handleSubmit] recognizedClaimNames:", recognizedClaimNames)
        console.log("[handleSubmit] selectedFollowUpTemplate:", hasRecognizedClaims ? "smartFollowUp" : "none")
        if (finalQuestions.length > 0) {
          setExcludedClaims(updatedExcluded)
          const assistantMessage: Message = {
            role: "assistant",
            content: hasRecognizedClaims ? "我再确认一下，避免遗漏：" : "请再补充一些具体信息：",
          }
          setMessages((prev) => [...prev, assistantMessage])
        } else {
          // 没有可追问的 → 尝试直接从 Dify possible_claims 生成 claims
          if (difyClaims.length > 0) {
            const filteredClaims = difyClaims.filter(
              (c: { claim: string }) => !updatedExcluded.some((ex) =>
                c.claim.includes(ex) || ex.includes(c.claim)
              )
            )
            if (filteredClaims.length > 0) {
              setPossibleClaims(filteredClaims)
              setExcludedClaims(updatedExcluded)
              setCaseDescription([])
              setQuestions([])
              setCurrentStep("confirmation")
              console.log("[handleSubmit] → entering confirmation (from need_more_info fallback)")
              const assistantMessage: Message = {
                role: "assistant",
                content: "根据您的描述，我识别出以下可能的诉求，请确认您想主张的内容：",
              }
              setMessages((prev) => [...prev, assistantMessage])
              setIsThinking(false)
              return
            }
          }
          const assistantMessage: Message = {
            role: "assistant",
            content: "我还没有识别出明确诉求，请补充是否涉及离婚、子女、财产、出轨或家暴。",
          }
          setMessages((prev) => [...prev, assistantMessage])
        }
        // 有 excluded 要在 discovery 阶段生效
        if (newlyExcluded.length > 0) {
          setExcludedClaims(updatedExcluded)
        }
        setIsThinking(false)
        return
      }

      // possible_claims 非空 → 进入 confirmation（或 confirmation 内合并）
      if (Array.isArray(result?.possible_claims) && result.possible_claims.length > 0) {
        const rawNewClaims: Array<{ claim: string; confidence: string; reason: string }> = result.possible_claims
        const filteredNewClaims = rawNewClaims.filter(
          (c) => !updatedExcluded.some((ex) =>
            c.claim.includes(ex) || ex.includes(c.claim)
          )
        )
        console.log("[handleSubmit] possibleClaims before filter:", rawNewClaims.map((c: { claim: string }) => c.claim))
        console.log("[handleSubmit] possibleClaims after filter:", filteredNewClaims.map((c: { claim: string }) => c.claim))

        if (filteredNewClaims.length === 0) {
          setIsThinking(false)
          setExcludedClaims(updatedExcluded)
          const assistantMessage: Message = {
            role: "assistant",
            content: "我还没有识别出明确诉求，请补充是否涉及离婚、子女、财产、出轨或家暴。",
          }
          setMessages((prev) => [...prev, assistantMessage])
          return
        }

        const wasInConfirmation = currentStep === "confirmation"

        if (wasInConfirmation) {
          // confirmation 阶段补充输入 → 合并诉求，保留已有勾选
          const existingClaimTexts = new Set(possibleClaims.map((c) => c.claim))
          const merged = [...possibleClaims]
          for (const nc of filteredNewClaims) {
            if (!existingClaimTexts.has(nc.claim)) {
              merged.push(nc)
            }
          }
          setPossibleClaims(merged)
          setExcludedClaims(updatedExcluded)
          setCaseDescription([])
          setQuestions([])
          console.log("[handleSubmit] merged possibleClaims (staying in confirmation):", merged.map(c => c.claim))
          const assistantMessage: Message = {
            role: "assistant",
            content: "已根据您补充的信息重新整理诉求，请确认更新后的诉求列表：",
          }
          setMessages((prev) => [...prev, assistantMessage])
        } else {
          setPossibleClaims(filteredNewClaims)
          setExcludedClaims(updatedExcluded)
          setCaseDescription([])
          setQuestions([])
          setSelectedClaims(new Set())
          setCurrentStep("confirmation")
          console.log("[handleSubmit] → entering confirmation phase")
          const assistantMessage: Message = {
            role: "assistant",
            content: "根据您的描述，我识别出以下可能的诉求，请确认您想主张的内容：",
          }
          setMessages((prev) => [...prev, assistantMessage])
        }

        setIsThinking(false)
        return
      }

      // 没有任何识别结果
      setIsThinking(false)
      if (newlyExcluded.length > 0) setExcludedClaims(updatedExcluded)
      const assistantMessage: Message = {
        role: "assistant",
        content: "我还没有识别出明确诉求，请补充是否涉及离婚、子女、财产、出轨或家暴。",
      }
      setMessages((prev) => [...prev, assistantMessage])
    } catch (err) {
      setIsThinking(false)
      const errorDetail = err instanceof Error ? err.message : "未知错误"
      const assistantMessage: Message = {
        role: "assistant",
        content: `请求失败：${errorDetail}`,
      }
      setMessages((prev) => [...prev, assistantMessage])
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

      if (result && typeof result === "object" && !Array.isArray(result)) {
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

        // 风险提示：可能是 risks、risk_notes
        const risksRaw = Array.isArray(result.risks)
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
            const items = missingRaw.map((m: string | { text?: string; item?: string; title?: string; name?: string; material?: string; evidence_name?: string; reason?: string; description?: string; purpose?: string; detail?: string }) =>
              typeof m === "string" ? m : `${m.item || m.title || m.name || m.material || m.evidence_name || m.text || ""}${(m.reason || m.description || m.purpose || m.detail) ? `：${m.reason || m.description || m.purpose || m.detail}` : ""}`
            )
            const lawyerChecklist = Array.isArray(result.lawyer_visit_checklist) ? result.lawyer_visit_checklist : []
            if (lawyerChecklist.length > 0) {
              items.push("【咨询律师前建议准备】")
              lawyerChecklist.forEach((tip: string) => items.push(`  → ${tip}`))
            }
            return items
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
  const evidenceCount = currentAnalysis?.evidenceChecklist.length ?? 0

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
                {isThinking && <ThinkingIndicator />}
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
                {currentStep === "confirmation" && Array.isArray(possibleClaims) && possibleClaims.length > 0 && (
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
            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-4 p-4">
                <AnalysisSidebar analysis={currentAnalysis} rawResult={rawAnalysisResult} />
              </div>
            </ScrollArea>
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

function AnalysisSidebar({
  analysis,
  rawResult,
}: {
  analysis: AnalysisResult
  rawResult: Record<string, unknown> | null
}) {
  const raw = rawResult || {}

  const priorityEvidence = filterValidEvidence(Array.isArray(raw.priority_evidence) ? raw.priority_evidence : [])
  const generalEvidence = filterValidEvidence(Array.isArray(raw.general_evidence) ? raw.general_evidence : [])
  const missingEvidence = filterValidEvidence(Array.isArray(raw.missing_evidence) ? raw.missing_evidence : [])
  const riskNotes = Array.isArray(raw.risk_notes) ? raw.risk_notes : []
  const lawyerChecklist = Array.isArray(raw.lawyer_visit_checklist) ? raw.lawyer_visit_checklist : []

  const hasAnyEvidence = priorityEvidence.length > 0 || generalEvidence.length > 0 || missingEvidence.length > 0

  const claims = Array.isArray(analysis.claims) ? analysis.claims : []

  // 标记已确认诉求的辅助函数
  const confidenceBadge = (confidence: string) => {
    const variants: Record<string, string> = {
      high: "bg-primary/10 text-primary",
      medium: "bg-chart-4/10 text-chart-4",
      low: "bg-muted text-muted-foreground",
    }
    const labels: Record<string, string> = { high: "高", medium: "可能涉及", low: "待确认" }
    return (
      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${variants[confidence] || variants.medium}`}>
        {labels[confidence] || confidence}
      </span>
    )
  }

  return (
    <div className="space-y-5">
      {/* 案件类型 */}
      <div>
        <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">案件类型</p>
        <Badge variant="outline" className="text-xs">{String(analysis.caseType || "婚姻家庭纠纷")}</Badge>
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

      {/* 证据清单区域 */}
      {hasAnyEvidence ? (
        <>
          {/* 优先准备证据 */}
          {priorityEvidence.length > 0 && (
            <SectionCard
              title="优先准备"
              badge="必要"
              badgeClass="bg-destructive/10 text-destructive"
              items={priorityEvidence}
              defaultChecked={false}
            />
          )}

          {/* 一般准备证据 */}
          {generalEvidence.length > 0 && (
            <SectionCard
              title="一般准备"
              badge="建议"
              badgeClass="bg-chart-4/10 text-chart-4"
              items={generalEvidence}
              defaultChecked={false}
            />
          )}

          {/* 待补充材料 */}
          {missingEvidence.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-medium text-muted-foreground">待补充材料</p>
              <div className="space-y-2">
                {missingEvidence.map((e, i: number) => (
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

      {/* 风险提示 */}
      {riskNotes.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">风险提示</p>
          <div className="space-y-1.5">
            {riskNotes.map((r: unknown, i: number) => (
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
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-medium text-foreground">分析报告</span>
        <button
          onClick={() => setOpen(false)}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4">
          <AnalysisSidebar analysis={analysis} rawResult={rawResult} />
        </div>
      </ScrollArea>
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
  const risks = Array.isArray(analysis.risks) ? analysis.risks : []

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
      content: evidenceChecklist.length > 0 ? (
        <div className="space-y-1.5">
          {evidenceChecklist.filter((e) => e.priority === "high").slice(0, 3).map((e) => (
            <div key={e.id} className="flex items-start gap-2 text-sm text-foreground/80">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-destructive" />
              {String(e.text)}
            </div>
          ))}
          <span className="text-xs text-muted-foreground">
            共 {evidenceChecklist.length} 项（详见右侧报告）
          </span>
        </div>
      ) : (
        <div className="text-sm text-destructive">
          证据清单生成失败，请检查 Dify Analysis 应用配置或重试。
        </div>
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

  const [selected, setSelected] = useState<Set<string>>(() => {
    if (selectedClaims.size > 0) return new Set(selectedClaims)
    const initial = new Set<string>()
    safeClaims.forEach((c) => {
      if (c.confidence === "high" || c.confidence === "medium") {
        initial.add(c.claim)
      }
    })
    return initial
  })

  // 当 possibleClaims 变化时（合并/过滤），同步清理已不存在的选中项
  useEffect(() => {
    const currentClaimTexts = new Set(safeClaims.map((c) => c.claim))
    setSelected((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const c of prev) {
        if (!currentClaimTexts.has(c)) { next.delete(c); changed = true }
      }
      return changed ? next : prev
    })
  }, [safeClaims])

  const toggle = (claimText: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(claimText)) next.delete(claimText)
      else next.add(claimText)
      onSelectionChange(next)
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
      high: "高",
      medium: "可能涉及",
      low: "待确认",
    }
    return (
      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${variants[confidence] || variants.medium}`}>
        {labels[confidence] || confidence}
      </span>
    )
  }

  if (safeClaims.length === 0) {
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
        {safeClaims.map((item, i) => (
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
        确认诉求并生成证据清单
      </button>
    </div>
  )
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 py-2 animate-in fade-in duration-300">
      <div className="flex gap-1">
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/50" style={{ animationDelay: "0ms" }} />
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/50" style={{ animationDelay: "150ms" }} />
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/50" style={{ animationDelay: "300ms" }} />
      </div>
      <span className="text-xs text-muted-foreground/60">正在分析案情...</span>
    </div>
  )
}

export default App
