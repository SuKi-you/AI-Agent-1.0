// src/utils/stateMachine.ts
// 状态机门控与关键追问

export interface ConfirmationContext {
  accumulatedText: string
  possibleClaims: Array<{ claim: string }>
  excludedClaims: string[]
  hasAskedKeyQuestion: boolean
  isTopicNegationOrNoMore: boolean  // true when latest user input is "不涉及"/"没有" etc.
  hasChildrenKeywords?: boolean     // true when user input mentions children/custody
}

export function shouldEnterConfirmation(params: ConfirmationContext): {
  shouldEnter: boolean
  shouldAskKeyQuestion: boolean
  reason: string
} {
  if (params.possibleClaims.length === 0) {
    return { shouldEnter: false, shouldAskKeyQuestion: false, reason: "无已识别诉求" }
  }

  // 不止"离婚"一个诉求 → 信息基本足够
  const nonDivorceClaims = params.possibleClaims.filter((c) => !c.claim.includes("离婚"))
  if (nonDivorceClaims.length > 0) {
    return { shouldEnter: true, shouldAskKeyQuestion: false, reason: "存在多个诉求类型 (nonDivorce: " + nonDivorceClaims.map(c => c.claim).join(",") + ")" }
  }

  // ── 以下：只有"离婚"一个诉求 ──

  // 用户已明确提到孩子/抚养权 → 即使 Dify 返回的 claims 中漏了，也不走 only-divorce 追问
  if (params.hasChildrenKeywords) {
    console.log("[shouldEnterConfirmation] hasChildrenKeywords=true but Dify returned only 离婚 — overriding to enter confirmation")
    return { shouldEnter: true, shouldAskKeyQuestion: false, reason: "用户提及孩子/抚养权关键词，跳过 only-divorce 追问" }
  }

  const hasDivorceIntent = /我想离婚|想离婚|我要离婚|想分开|过不下去|不想过了|想离|感情不和/.test(params.accumulatedText)
  const hasDivorceReason = /长期分居|出轨|家暴|不回家|争吵|暴力|虐待|冷暴力|受不了/.test(params.accumulatedText)
  const hasExcludedOther = params.excludedClaims.some((c) =>
    /子女|抚养|财产|房产|债务|损害赔偿|探望/.test(c)
  )
  const hasMarriageFact = /老公|老婆|配偶|已婚|结婚|领证|登记|夫妻|先生|太太/.test(params.accumulatedText)
  const hasSpouseAgreement = /对方.*同意|不同意|愿意离|协议离婚|想协议|对方.*不想/.test(params.accumulatedText)

  const metCount = [hasDivorceIntent, hasDivorceReason, hasExcludedOther, hasMarriageFact, hasSpouseAgreement]
    .filter(Boolean).length

  // 关键追问已回答 → 允许进入
  if (params.hasAskedKeyQuestion) {
    return { shouldEnter: true, shouldAskKeyQuestion: false, reason: "已回答关键追问" }
  }

  // 最新输入是"不涉及"/"没有" → 需要 3+ 条条件（而非仅意愿+原因）
  if (params.isTopicNegationOrNoMore) {
    if (metCount >= 3) {
      return { shouldEnter: true, shouldAskKeyQuestion: false, reason: `不涉及/没有但满足${metCount}个条件` }
    }
    if (metCount >= 1) {
      return { shouldEnter: false, shouldAskKeyQuestion: true,
        reason: `刚回复不涉及/没有(仅${metCount}个条件)，需追问关键婚姻信息` }
    }
    return { shouldEnter: false, shouldAskKeyQuestion: true, reason: "信息不足" }
  }

  // 正常路径 → 需要 2+ 条条件
  if (metCount >= 2) {
    return { shouldEnter: true, shouldAskKeyQuestion: false, reason: `满足${metCount}个条件` }
  }

  // 不足 2 条 → 追问关键问题（如果还没问过）
  return { shouldEnter: false, shouldAskKeyQuestion: true,
    reason: `仅${metCount}个条件，需追问关键信息` }
}

export function getKeyQuestionMessage(): string {
  return "我理解您目前主要想处理的是离婚本身。为了后续生成更准确的证据清单，我再确认一个关键信息：您和对方是否已经登记结婚？对方是否同意离婚？"
}

export function detectKeyQuestionAnswer(userInput: string): boolean {
  return /登记|结婚|领证|已婚|老公|老婆|配偶|夫妻|先生|太太|对方.*同意|对方.*不同意|对方.*不想|协议离婚|想协议|不愿意/.test(userInput)
}
