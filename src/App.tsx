import { useState, useRef, useEffect, useCallback } from "react"
import {
  ArrowUp as ArrowUpIcon,
  Sun as SunIcon,
  Moon as MoonIcon,
  Mic as MicIcon,
  Square as SquareIcon,
  Scale as ScaleIcon,
  FileCheck as FileCheckIcon,
  MessageSquare as MessageSquareIcon,
  X as XIcon,
} from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { supabase } from "@/lib/supabase"

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


export function App() {
  const { theme, setTheme } = useTheme()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isThinking, setIsThinking] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [visibleSections, setVisibleSections] = useState(0)
  const [activeTab, setActiveTab] = useState("chat")
  const [currentAnalysis, setCurrentAnalysis] = useState<AnalysisResult | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<"idle" | "need_more_info" | "claim_selection">("idle")
  const [questions, setQuestions] = useState<string[]>([])
  const [possibleClaims, setPossibleClaims] = useState<Array<{ claim: string; confidence: string; reason: string }>>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, visibleSections])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + "px"
    }
  }, [input])

  const saveToDatabase = async (
    userContent: string,
    analysis: AnalysisResult,
    convId: string | null
  ) => {
    let currentConvId = convId
    if (!currentConvId) {
      const { data } = await supabase
        .from("conversations")
        .insert({ title: userContent.slice(0, 50) })
        .select("id")
        .maybeSingle()
      if (data) {
        currentConvId = data.id
        setConversationId(currentConvId)
      }
    }
    if (!currentConvId) return

    await supabase
      .from("messages")
      .insert({ conversation_id: currentConvId, role: "user", content: userContent })

    const { data: assistantMsg } = await supabase
      .from("messages")
      .insert({ conversation_id: currentConvId, role: "assistant", content: JSON.stringify(analysis) })
      .select("id")
      .maybeSingle()

    if (assistantMsg) {
      await supabase.from("analysis_results").insert({
        conversation_id: currentConvId,
        message_id: assistantMsg.id,
        case_type: analysis.caseType,
        key_facts: analysis.keyFacts,
        claims: analysis.claims,
        risks: analysis.risks,
        evidence_checklist: analysis.evidenceChecklist,
        missing_info: analysis.missingInfo,
      })
    }
  }

  const callIntentApi = async (query: string) => {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dify-intent`
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, user: "demo-user" }),
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      const detail = errorData?.error || errorData?.detail || `HTTP ${response.status}`
      throw new Error(detail)
    }
    const data = await response.json()
    if (data.error) {
      throw new Error(data.error)
    }
    return data.result
  }

  const callAnalysisApi = async (query: string, confirmedClaims: string[]) => {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dify-analysis`
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, confirmed_claims: confirmedClaims, user: "demo-user" }),
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      const detail = errorData?.error || errorData?.detail || `HTTP ${response.status}`
      throw new Error(detail)
    }
    const data = await response.json()
    if (data.error) {
      throw new Error(data.error)
    }
    return data.result
  }

  const handleSubmit = async () => {
    if (!input.trim() || isThinking) return

    const userContent = input.trim()
    const userMessage: Message = { role: "user", content: userContent }
    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsThinking(true)
    setVisibleSections(0)

    try {
      const result = await callIntentApi(userContent)

      if (result?.status === "need_more_info") {
        const questionsList = Array.isArray(result.questions) ? result.questions : []
        setQuestions(questionsList)
        setCurrentStep("need_more_info")
        const assistantMessage: Message = {
          role: "assistant",
          content: questionsList.length > 0 ? questionsList.join("\n") : "请补充更多信息",
        }
        setMessages((prev) => [...prev, assistantMessage])
        setIsThinking(false)
        return
      }

      if (Array.isArray(result?.possible_claims)) {
        setPossibleClaims(result.possible_claims)
        setCurrentStep("claim_selection")
        const assistantMessage: Message = {
          role: "assistant",
          content: "根据您的描述，我识别出以下可能的诉求，请确认：",
        }
        setMessages((prev) => [...prev, assistantMessage])
        setIsThinking(false)
        return
      }

      setIsThinking(false)
      if (result?.raw_text) {
        const assistantMessage: Message = { role: "assistant", content: result.raw_text }
        setMessages((prev) => [...prev, assistantMessage])
      } else {
        const content = typeof result === "string" ? result : "无法识别您的意图，请尝试更详细地描述您的情况。"
        const assistantMessage: Message = { role: "assistant", content }
        setMessages((prev) => [...prev, assistantMessage])
      }
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
    setIsThinking(true)
    setCurrentStep("idle")
    setPossibleClaims([])
    const confirmedClaimsStr = selectedClaimTexts.join("、")
    const userMessage: Message = { role: "user", content: `确认诉求：${confirmedClaimsStr}` }
    setMessages((prev) => [...prev, userMessage])

    const originalUserMessage = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n")

    try {
      const result = await callAnalysisApi(originalUserMessage, selectedClaimTexts)

      if (result && typeof result === "object" && !Array.isArray(result)) {
        const claimsRaw = Array.isArray(result.claims) ? result.claims : selectedClaimTexts
        const evidenceRaw = Array.isArray(result.evidence_checklist)
          ? result.evidence_checklist
          : Array.isArray(result.evidenceChecklist)
          ? result.evidenceChecklist
          : []

        const analysis: AnalysisResult = {
          caseType: result.case_type || result.caseType || "婚姻家庭纠纷",
          keyFacts: Array.isArray(result.key_facts) ? result.key_facts : Array.isArray(result.keyFacts) ? result.keyFacts : [],
          claims: claimsRaw.map((c: string | { text: string; category?: string }, i: number) => ({
            id: String(i + 1),
            text: typeof c === "string" ? c : (c.text || ""),
            selected: true,
            category: typeof c === "string" ? "诉求" : (c.category || "诉求"),
          })),
          risks: Array.isArray(result.risks) ? result.risks : [],
          evidenceChecklist: evidenceRaw.map(
            (e: string | { text: string; priority?: string; category?: string }, i: number) => ({
              id: `e${i + 1}`,
              text: typeof e === "string" ? e : (e.text || ""),
              collected: false,
              priority: (typeof e === "object" && e.priority) || "medium",
              category: (typeof e === "object" && e.category) || "证据材料",
            })
          ),
          missingInfo: Array.isArray(result.missing_info) ? result.missing_info : Array.isArray(result.missingInfo) ? result.missingInfo : [],
        }
        setCurrentAnalysis(analysis)
        setIsThinking(false)
        const assistantMessage: Message = { role: "assistant", content: "", analysis }
        setMessages((prev) => [...prev, assistantMessage])
        revealSections()
        saveToDatabase(confirmedClaimsStr, analysis, conversationId)
      } else {
        setIsThinking(false)
        const content = typeof result === "string" ? result : "分析完成"
        const assistantMessage: Message = { role: "assistant", content }
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

  const toggleClaim = (claimId: string) => {
    if (!currentAnalysis) return
    setCurrentAnalysis({
      ...currentAnalysis,
      claims: currentAnalysis.claims.map((c) =>
        c.id === claimId ? { ...c, selected: !c.selected } : c
      ),
    })
  }

  const toggleEvidence = (evidenceId: string) => {
    if (!currentAnalysis) return
    setCurrentAnalysis({
      ...currentAnalysis,
      evidenceChecklist: currentAnalysis.evidenceChecklist.map((e) =>
        e.id === evidenceId ? { ...e, collected: !e.collected } : e
      ),
    })
  }

  const selectedClaimsCount = currentAnalysis?.claims.filter((c) => c.selected).length ?? 0
  const collectedEvidenceCount = currentAnalysis?.evidenceChecklist.filter((e) => e.collected).length ?? 0
  const totalEvidenceCount = currentAnalysis?.evidenceChecklist.length ?? 0

  const isEmpty = messages.length === 0 && !isThinking

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
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

      <div className="flex flex-1 overflow-hidden">
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-4">
            {isEmpty ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-24 text-center">
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
              <ScrollArea className="flex-1 py-6">
                <div className="space-y-6 pr-4">
                  {messages.map((msg, i) => (
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
                          onViewClaims={() => setActiveTab("claims")}
                          onViewEvidence={() => setActiveTab("evidence")}
                        />
                      ) : (
                        <div className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">
                          {msg.content}
                        </div>
                      )}
                    </div>
                  ))}
                  {isThinking && <ThinkingIndicator />}
                  {currentStep === "need_more_info" && Array.isArray(questions) && questions.length > 0 && (
                    <div className="space-y-2 rounded-xl border border-border bg-secondary/50 p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <p className="text-xs font-medium text-muted-foreground">请补充以下信息：</p>
                      <ul className="space-y-1.5">
                        {questions.map((q, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-foreground/40" />
                            {q}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {currentStep === "claim_selection" && Array.isArray(possibleClaims) && possibleClaims.length > 0 && (
                    <ClaimSelectionUI
                      claims={possibleClaims}
                      onConfirm={handleConfirmClaims}
                    />
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
            )}

            <div className="relative pb-4 pt-2">
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
                AI 分析仅供参考，不构成法律建议
              </p>
            </div>
          </div>
        </main>

        {currentAnalysis && (
          <aside className="hidden w-[380px] border-l border-border lg:flex lg:flex-col">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col overflow-hidden">
              <div className="border-b border-border px-4 pt-3">
                <TabsList variant="line" className="w-full">
                  <TabsTrigger value="chat" className="flex-1 gap-1.5">
                    <MessageSquareIcon className="size-3.5" />
                    概览
                  </TabsTrigger>
                  <TabsTrigger value="claims" className="flex-1 gap-1.5">
                    <ScaleIcon className="size-3.5" />
                    诉求
                    {selectedClaimsCount > 0 && (
                      <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                        {selectedClaimsCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="evidence" className="flex-1 gap-1.5">
                    <FileCheckIcon className="size-3.5" />
                    证据
                    {totalEvidenceCount > 0 && (
                      <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                        {collectedEvidenceCount}/{totalEvidenceCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="chat" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-full">
                  <div className="space-y-5 p-4">
                    <div>
                      <p className="mb-2 text-xs font-medium text-muted-foreground">案件类型</p>
                      <Badge variant="outline" className="text-xs">{currentAnalysis.caseType || "未知"}</Badge>
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-medium text-muted-foreground">关键事实</p>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.isArray(currentAnalysis.keyFacts) && currentAnalysis.keyFacts.map((f) => (
                          <Badge key={f} variant="secondary" className="text-xs">{f}</Badge>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-medium text-muted-foreground">风险提示</p>
                      <ul className="space-y-1.5">
                        {Array.isArray(currentAnalysis.risks) && currentAnalysis.risks.map((r) => (
                          <li key={r} className="flex items-start gap-2 text-xs text-foreground/70">
                            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-chart-4" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-medium text-muted-foreground">缺失信息</p>
                      <ul className="space-y-1.5">
                        {Array.isArray(currentAnalysis.missingInfo) && currentAnalysis.missingInfo.map((m) => (
                          <li key={m} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/40" />
                            {m}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="claims" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-full">
                  <ClaimsPanel
                    claims={currentAnalysis.claims}
                    onToggle={toggleClaim}
                  />
                </ScrollArea>
              </TabsContent>

              <TabsContent value="evidence" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-full">
                  <EvidencePanel
                    items={currentAnalysis.evidenceChecklist}
                    onToggle={toggleEvidence}
                  />
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </aside>
        )}
      </div>

      {currentAnalysis && (
        <MobilePanel
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          analysis={currentAnalysis}
          onToggleClaim={toggleClaim}
          onToggleEvidence={toggleEvidence}
          selectedClaimsCount={selectedClaimsCount}
          collectedEvidenceCount={collectedEvidenceCount}
          totalEvidenceCount={totalEvidenceCount}
        />
      )}
    </div>
  )
}

function MobilePanel({
  activeTab,
  setActiveTab,
  analysis,
  onToggleClaim,
  onToggleEvidence,
  selectedClaimsCount,
  collectedEvidenceCount,
  totalEvidenceCount,
}: {
  activeTab: string
  setActiveTab: (tab: string) => void
  analysis: AnalysisResult
  onToggleClaim: (id: string) => void
  onToggleEvidence: (id: string) => void
  selectedClaimsCount: number
  collectedEvidenceCount: number
  totalEvidenceCount: number
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <div className="fixed bottom-20 right-4 flex gap-2 lg:hidden">
        <button
          onClick={() => { setActiveTab("claims"); setOpen(true) }}
          className="flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground shadow-sm"
        >
          <ScaleIcon className="size-3.5" />
          诉求 ({selectedClaimsCount})
        </button>
        <button
          onClick={() => { setActiveTab("evidence"); setOpen(true) }}
          className="flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground shadow-sm"
        >
          <FileCheckIcon className="size-3.5" />
          证据 ({collectedEvidenceCount}/{totalEvidenceCount})
        </button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background lg:hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList variant="line">
            <TabsTrigger value="claims">诉求</TabsTrigger>
            <TabsTrigger value="evidence">证据</TabsTrigger>
          </TabsList>
        </Tabs>
        <button
          onClick={() => setOpen(false)}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <ScrollArea className="flex-1">
        {activeTab === "claims" ? (
          <ClaimsPanel claims={analysis.claims} onToggle={onToggleClaim} />
        ) : (
          <EvidencePanel items={analysis.evidenceChecklist} onToggle={onToggleEvidence} />
        )}
      </ScrollArea>
    </div>
  )
}

function ClaimsPanel({ claims, onToggle }: { claims: Claim[]; onToggle: (id: string) => void }) {
  const categories = [...new Set(claims.map((c) => c.category))]

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          选择您想要主张的诉求
        </p>
        <Badge variant="secondary" className="text-[10px]">
          已选 {claims.filter((c) => c.selected).length}/{claims.length}
        </Badge>
      </div>
      {categories.map((category) => (
        <div key={category}>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            {category}
          </p>
          <div className="space-y-2">
            {claims
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
                  <span className="text-sm text-foreground">{claim.text}</span>
                </label>
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function EvidencePanel({ items, onToggle }: { items: EvidenceItem[]; onToggle: (id: string) => void }) {
  const categories = [...new Set(items.map((e) => e.category))]
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
          {items.filter((e) => e.collected).length}/{items.length} 已收集
        </Badge>
      </div>
      {categories.map((category) => (
        <div key={category}>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            {category}
          </p>
          <div className="space-y-2">
            {items
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
                      {item.text}
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
  onViewClaims,
  onViewEvidence,
}: {
  analysis: AnalysisResult
  content: string
  visibleSections: number
  onViewClaims: () => void
  onViewEvidence: () => void
}) {
  const keyFacts = Array.isArray(analysis.keyFacts) ? analysis.keyFacts : []
  const claims = Array.isArray(analysis.claims) ? analysis.claims : []
  const evidenceChecklist = Array.isArray(analysis.evidenceChecklist) ? analysis.evidenceChecklist : []
  const risks = Array.isArray(analysis.risks) ? analysis.risks : []

  const sections = [
    {
      label: "案件类型",
      content: (
        <Badge variant="outline" className="text-xs">{analysis.caseType || "未知"}</Badge>
      ),
    },
    {
      label: "关键事实",
      content: (
        <div className="flex flex-wrap gap-1.5">
          {keyFacts.map((f) => (
            <Badge key={f} variant="secondary" className="text-xs">{f}</Badge>
          ))}
        </div>
      ),
    },
    {
      label: "建议诉求",
      content: (
        <div className="space-y-1.5">
          {claims.filter((c) => c.selected).slice(0, 3).map((c) => (
            <div key={c.id} className="flex items-start gap-2 text-sm text-foreground/80">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-foreground/40" />
              {c.text}
            </div>
          ))}
          {claims.filter((c) => c.selected).length > 3 && (
            <button
              onClick={onViewClaims}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              查看全部 {claims.filter((c) => c.selected).length} 项诉求 →
            </button>
          )}
        </div>
      ),
    },
    {
      label: "证据清单",
      content: (
        <div className="space-y-1.5">
          {evidenceChecklist.filter((e) => e.priority === "high").slice(0, 3).map((e) => (
            <div key={e.id} className="flex items-start gap-2 text-sm text-foreground/80">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-destructive" />
              {e.text}
            </div>
          ))}
          <button
            onClick={onViewEvidence}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            查看完整清单（{evidenceChecklist.length} 项）→
          </button>
        </div>
      ),
    },
    {
      label: "风险提示",
      content: (
        <ul className="space-y-1">
          {risks.map((r) => (
            <li key={r} className="flex items-start gap-2 text-sm text-foreground/60">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-chart-4" />
              {r}
            </li>
          ))}
        </ul>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {content && (
        <div className="text-sm leading-relaxed text-foreground/80">{content}</div>
      )}
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
}: {
  claims: Array<{ claim: string; confidence: string; reason: string }>
  onConfirm: (selected: string[]) => void
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(claims.map((_, i) => i)))

  const toggle = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
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
      medium: "中",
      low: "低",
    }
    return (
      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${variants[confidence] || variants.medium}`}>
        {labels[confidence] || confidence}
      </span>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-secondary/50 p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <p className="text-xs font-medium text-muted-foreground">请确认您想主张的诉求：</p>
      <div className="space-y-2">
        {claims.map((item, i) => (
          <label key={i} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-3 transition-colors hover:bg-accent">
            <Checkbox
              checked={selected.has(i)}
              onCheckedChange={() => toggle(i)}
              className="mt-0.5"
            />
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground">{item.claim}</span>
                {confidenceBadge(item.confidence)}
              </div>
              {item.reason && (
                <span className="text-xs text-muted-foreground">{item.reason}</span>
              )}
            </div>
          </label>
        ))}
      </div>
      <button
        onClick={() => onConfirm(claims.filter((_, i) => selected.has(i)).map((c) => c.claim))}
        disabled={selected.size === 0}
        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
      >
        确认诉求并开始分析
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
