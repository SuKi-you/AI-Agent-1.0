// src/utils/claimDetection.ts
// 常量、关键词匹配、否定诉求提取、低信息拦截、Claim 兜底函数

export const NEGATION_KEYWORDS = [
  "不想", "不要", "不主张", "不处理", "暂时不考虑",
  "不争", "不需要", "不想要", "不打算", "放弃",
  "不要求", "不涉及", "不准备",
]

export const KNOWN_CLAIMS = [
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
  "出轨", "婚内过错", "第三者",
]

export function detectExcludedClaims(userInput: string): string[] {
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
      // 特殊处理：否定关键词后出现"孩子"/"子女"→ 排除子女抚养权、抚养费、探望权
      if (/孩子|子女/.test(after)) {
        const childClaims = ["子女抚养权", "孩子抚养权", "抚养权", "子女抚养费", "孩子抚养费", "抚养费", "探望权", "探视权"]
        for (const cc of childClaims) {
          if (!found.includes(cc)) {
            found.push(cc)
          }
        }
        console.log("[detectExcludedClaims] child-related exclusion detected: keyword=", keyword, "after=", after, "added:", childClaims.filter(c => !found.includes(c)))
      }
      // 特殊处理：否定关键词后出现"房子"/"房产"/"不动产"→ 排除财产分割、房产分割
      if (/房子|房产|不动产|房屋/.test(after)) {
        const houseClaims = ["财产分割", "夫妻共同财产分割", "房产分割"]
        for (const hc of houseClaims) {
          if (!found.includes(hc)) {
            found.push(hc)
          }
        }
        console.log("[detectExcludedClaims] house-related exclusion detected: keyword=", keyword, "after=", after, "added:", houseClaims.filter(c => !found.includes(c)))
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
export const DETAIL_PATTERNS = [
  /房产/, /存款/, /车辆/, /债务/, /工资/, /收入/, /流水/,
  /谁照顾/, /日常照顾/, /生活安排/, /教育/, /学费/, /学校/,
  /分居.*证据/, /家暴.*证据/, /出轨.*证据/, /证据.*收集/,
  /对方.*收入/, /对方.*财产/, /对方.*工作/, /对方.*名下/,
  /具体.*金额/, /具体.*价值/, /市值/, /评估/,
  /报警.*记录/, /就医.*记录/, /聊天.*记录/, /短信/,
]

export function filterAndLimitQuestions(raw: string[], excludedClaims: string[]): string[] {
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
export const MENTION_PATTERNS: { claim: string; label: string; patterns: RegExp[] }[] = [
  { claim: "离婚", label: "离婚", patterns: [/离婚/, /想离/, /过不下去/, /分开/, /解除婚姻/, /离了/] },
  { claim: "抚养权", label: "子女抚养权", patterns: [/抚养权/, /孩子归谁/, /孩子跟谁/, /子女.*谁照顾/, /孩子.*谁带/] },
  { claim: "抚养费", label: "抚养费", patterns: [/抚养费/, /生活费/, /教育费/, /学费/] },
  { claim: "财产分割", label: "财产分割", patterns: [/财产分割/, /房子/, /房产/, /共同财产/, /分财产/, /财产怎么/, /存款/, /车辆/] },
  { claim: "损害赔偿", label: "家暴/出轨赔偿", patterns: [/出轨/, /家暴/, /打我/, /威胁/, /虐待/, /冷暴力/, /婚外情/] },
  { claim: "探望权", label: "探望权", patterns: [/探望/, /探视/, /看孩子/] },
]

// 所有可能的追问方向
export const FOLLOW_UP_DIRECTIONS = [
  { claim: "离婚", phrase: "离婚本身" },
  { claim: "抚养权", phrase: "子女抚养权归属" },
  { claim: "抚养费", phrase: "子女抚养费" },
  { claim: "财产分割", phrase: "夫妻财产/房产/存款分割" },
  { claim: "损害赔偿", phrase: "家暴或出轨的损害赔偿" },
  { claim: "探望权", phrase: "子女探望安排" },
]

// 追问方向 → 排除时对应的 claim 名称
export const TOPIC_TO_EXCLUDED_CLAIMS: Record<string, string[]> = {
  "抚养权": ["子女抚养权", "抚养权", "孩子抚养权"],
  "探望权": ["探望权", "探视权"],
  "抚养费": ["子女抚养费", "抚养费", "孩子抚养费"],
  "财产分割": ["财产分割", "夫妻共同财产分割", "房产分割"],
  "损害赔偿": ["离婚损害赔偿", "损害赔偿", "人身安全保护令"],
}

// 用户输入中是否表达了离婚/分开意图
export const DIVORCE_INTENT_PATTERNS = [
  /我想离婚/, /想离婚/, /我要离婚/, /我想离/, /想离/,
  /想分开/, /过不下去/, /感情不和/, /婚姻.*继续/,
  /不想过了/, /不想继续/, /婚姻.*破裂/, /过不下去/,
  /分开/, /离婚/, /离了/,
]

export function detectDivorceIntent(accumulatedText: string): boolean {
  return DIVORCE_INTENT_PATTERNS.some((p) => p.test(accumulatedText))
}

export function ensureBaseDivorceClaim(
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

export const CHILDREN_CUSTODY_PATTERNS = /孩子|子女|小孩|儿子|女儿|抚养权|抚养费|争抚养权|争夺抚养权|孩子跟谁|孩子归谁|孩子跟我|孩子归我|孩子和我|想要孩子|争孩子|跟我生活|和我生活|跟我过|和我过/

export function hasChildrenCustodyIntent(text: string): boolean {
  return CHILDREN_CUSTODY_PATTERNS.test(text)
}

export const CHILD_EXCLUSION_PATTERNS = /成年了|已成年|成年子女|满18|不涉及孩子|不涉及子女|不需要处理孩子|不需要处理子女|不要抚养权|不要抚养费|孩子不用处理|子女不用处理|不争抚养权|放弃抚养权|不需要孩子|不想要抚养权/

export function hasChildExclusionIntent(text: string): boolean {
  return CHILD_EXCLUSION_PATTERNS.test(text)
}

export const CHILD_KEYWORD_PATTERNS = /孩子|子女|未成年|儿子|女儿|小孩/
export const CHILD_CARE_PATTERNS = /跟我生活|跟我过|跟我住|孩子归我|孩子跟我|我带孩子|我照顾孩子|争抚养权|想要抚养权|和我生活|和我过|和我住/

export const CHILD_SUPPORT_EXCLUSION_PATTERNS = /不要抚养费|不需要抚养费|不让对方出钱|不想要抚养费|放弃抚养费/

export function supplementChildrenClaim(
  claims: Array<{ claim: string; confidence: string; reason: string }>,
  userText: string,
): Array<{ claim: string; confidence: string; reason: string }> {
  if (!hasChildrenCustodyIntent(userText)) return claims
  // 用户明确排除子女相关诉求（如成年/不需要处理孩子）→ 不兜底补充
  if (hasChildExclusionIntent(userText)) {
    console.log("[supplementChildrenClaim] user excluded child custody, NOT supplementing. matched patterns:", userText.match(CHILD_EXCLUSION_PATTERNS))
    return claims
  }
  const hasCustodyClaim = claims.some(
    (c) => c.claim.includes("抚养权") || c.claim.includes("子女")
  )
  if (hasCustodyClaim) return claims
  console.log("[supplementChildrenClaim] Dify missed child custody claim, adding fallback. userText keywords matched:", userText.match(CHILDREN_CUSTODY_PATTERNS))
  return [
    ...claims,
    { claim: "子女抚养权", confidence: "high", reason: "用户明确提到有孩子并想争夺抚养权" },
  ]
}

export function supplementChildSupportClaim(
  claims: Array<{ claim: string; confidence: string; reason: string }>,
  userText: string,
): Array<{ claim: string; confidence: string; reason: string }> {
  // 需同时满足：子女关键词 + 抚养安排关键词
  if (!CHILD_KEYWORD_PATTERNS.test(userText) || !CHILD_CARE_PATTERNS.test(userText)) return claims

  // 用户明确不要抚养费 → 不兜底补充
  if (CHILD_SUPPORT_EXCLUSION_PATTERNS.test(userText)) {
    console.log("[supplementChildSupportClaim] user explicitly excluded child support, skipping. matched:", userText.match(CHILD_SUPPORT_EXCLUSION_PATTERNS))
    return claims
  }

  const hasChildSupportClaim = claims.some(
    (c) => c.claim.includes("抚养费")
  )
  if (hasChildSupportClaim) return claims

  console.log("[supplementChildSupportClaim] child + care arrangement detected, adding child support. child:", userText.match(CHILD_KEYWORD_PATTERNS), "care:", userText.match(CHILD_CARE_PATTERNS))
  return [
    ...claims,
    { claim: "抚养费", confidence: "medium", reason: "用户描述涉及未成年子女抚养安排，可能同时涉及抚养费承担问题" },
  ]
}

export const PROPERTY_TRANSFER_PATTERNS = /给别人转钱|给别人转账|给他人转钱|给他人转账|偷偷转走|转走.*钱|转钱|转账|转移财产|隐匿财产|取走钱|把钱转走|大额转账|异常转账|偷偷转账|偷偷转钱|存款转走|转走了/
export const PROPERTY_RECOVERY_PATTERNS = /追回|要回来|拿回来|返还|想要回来/

export function hasPropertyTransferIntent(text: string): boolean {
  return PROPERTY_TRANSFER_PATTERNS.test(text)
}

export function hasPropertyRecoveryIntent(text: string): boolean {
  return PROPERTY_RECOVERY_PATTERNS.test(text)
}

export function supplementPropertyTransferClaim(
  claims: Array<{ claim: string; confidence: string; reason: string }>,
  userText: string,
): Array<{ claim: string; confidence: string; reason: string }> {
  const hasTransfer = hasPropertyTransferIntent(userText)
  const hasRecovery = hasPropertyRecoveryIntent(userText)
  if (!hasTransfer && !hasRecovery) return claims

  const supplemented = [...claims]

  if (hasTransfer && !supplemented.some((c) => c.claim.includes("财产转移") || c.claim.includes("隐匿财产"))) {
    supplemented.push({
      claim: "财产转移",
      confidence: "high",
      reason: "用户描述对方偷偷转走大量钱款，可能涉及夫妻共同财产转移或隐匿",
    })
    console.log("[supplementPropertyTransferClaim] added fallback claim: 财产转移")
  }

  if (hasRecovery && !supplemented.some((c) => c.claim.includes("追回") || c.claim.includes("返还"))) {
    supplemented.push({
      claim: "追回财产",
      confidence: "medium",
      reason: "用户明确表达希望追回被转走的钱款",
    })
    console.log("[supplementPropertyTransferClaim] added fallback claim: 追回财产")
    // 追回财产通常隐含财产分割需求
    if (!supplemented.some((c) => c.claim.includes("财产分割"))) {
      supplemented.push({
        claim: "财产分割",
        confidence: "medium",
        reason: "财产转移通常与夫妻共同财产分割或财产保护相关",
      })
      console.log("[supplementPropertyTransferClaim] added fallback claim: 财产分割")
    }
  }

  if (supplemented.length > claims.length) {
    console.log("[supplementPropertyTransferClaim] claims supplemented:", claims.map(c => c.claim), "→", supplemented.map(c => c.claim))
  }
  return supplemented
}

export const PROPERTY_DIVISION_PATTERNS = /分财产|分割财产|财产分割|分房子|分房产|婚后财产|共同财产|房子怎么分|跟他分财产|想.*分.*房|怎么分.*房|财产.*处理|分割.*房产|婚后.*房|买.*房|一套房|房贷|购房|房产证|共同房产/

export function hasPropertyDivisionIntent(text: string): boolean {
  return PROPERTY_DIVISION_PATTERNS.test(text)
}

export const DEBT_PATTERNS = /债务|欠债|借款|贷款|外债|网贷|信用卡债|还债|共同债务/

export function hasDebtIntent(text: string): boolean {
  return DEBT_PATTERNS.test(text)
}

export function supplementPropertyDivisionClaim(
  claims: Array<{ claim: string; confidence: string; reason: string }>,
  userText: string,
): Array<{ claim: string; confidence: string; reason: string }> {
  if (!hasPropertyDivisionIntent(userText)) return claims

  const hasHouseKeywords = /婚后.*房|买.*房|一套房|房子|房产|房贷|购房|房产证|共同房产/.test(userText)
  const hasDivisionClaim = claims.some(
    (c) => c.claim.includes("财产分割") || c.claim.includes("房产分割")
  )
  const hasHouseClaim = claims.some((c) => c.claim.includes("房产分割"))

  const result = [...claims]
  let changed = false

  if (!hasDivisionClaim) {
    result.push({
      claim: "财产分割",
      confidence: "high",
      reason: hasHouseKeywords
        ? "用户描述婚后购置房产，可能涉及夫妻共同财产分割"
        : "用户明确表达希望处理夫妻财产分割问题",
    })
    changed = true
    console.log("[supplementPropertyDivisionClaim] added 财产分割")
  }

  if (!hasHouseClaim && hasHouseKeywords) {
    result.push({
      claim: "房产分割",
      confidence: "high",
      reason: "用户明确提到婚后房产，可能涉及房产归属或分割问题",
    })
    changed = true
    console.log("[supplementPropertyDivisionClaim] added 房产分割")
  }

  if (changed) {
    console.log("[supplementPropertyDivisionClaim] claims supplemented:", claims.map(c => c.claim), "→", result.map(c => c.claim))
  }
  return result
}

export function supplementDebtClaim(
  claims: Array<{ claim: string; confidence: string; reason: string }>,
  userText: string,
): Array<{ claim: string; confidence: string; reason: string }> {
  if (!hasDebtIntent(userText)) return claims

  const hasDebtClaim = claims.some((c) => c.claim.includes("债务"))
  if (hasDebtClaim) return claims

  console.log("[supplementDebtClaim] debt keywords detected, adding fallback. matched:", userText.match(DEBT_PATTERNS))
  return [
    ...claims,
    { claim: "债务处理", confidence: "high", reason: "用户明确提到家庭债务或债务责任分担问题" },
  ]
}

export const DOMESTIC_VIOLENCE_PATTERNS = /家暴|打我|动手|殴打|威胁|恐吓|伤害|报警|验伤|虐待/

export function hasDomesticViolenceIntent(text: string): boolean {
  return DOMESTIC_VIOLENCE_PATTERNS.test(text)
}

export const INFIDELITY_PATTERNS = /出轨|有情人|情人|外面有人|外面有女人|外面有男人|小三|第三者|婚外情|婚外关系|和别人同居|跟别人同居|与他人同居|重婚|暧昧对象|约会别人/

export function hasInfidelityIntent(text: string): boolean {
  return INFIDELITY_PATTERNS.test(text)
}

export const THIRD_PARTY_SPENDING_PATTERNS = /给情人花钱|给情人转钱|给第三者花钱|给第三者转钱|给小三花钱|给小三转钱|给别人花钱|给别人转钱|给情人买东西|给小三买东西|给第三者买房|给第三者买车|花了很多钱|花了200多万|我想要回来|想追回|要回来|追回/
export const THIRD_PARTY_SPECIFIC_SPENDING = /给情人|给第三者|给小三/

export function hasThirdPartySpendingIntent(text: string): boolean {
  return THIRD_PARTY_SPENDING_PATTERNS.test(text)
}

export function hasSpecificThirdPartySpending(text: string): boolean {
  return THIRD_PARTY_SPECIFIC_SPENDING.test(text)
}

export function supplementDomesticViolenceClaim(
  claims: Array<{ claim: string; confidence: string; reason: string }>,
  userText: string,
): Array<{ claim: string; confidence: string; reason: string }> {
  if (!hasDomesticViolenceIntent(userText)) return claims

  const hasViolenceClaim = claims.some(
    (c) => c.claim.includes("家暴") || c.claim.includes("人身安全保护")
      || c.claim.includes("保护令") || c.claim.includes("暴力")
  )
  if (hasViolenceClaim) return claims

  console.log("[supplementDomesticViolenceClaim] domestic violence detected, adding fallback. matched:", userText.match(DOMESTIC_VIOLENCE_PATTERNS))
  return [
    ...claims,
    { claim: "家暴 / 人身安全保护", confidence: "high", reason: "用户描述存在家庭暴力、威胁或人身安全风险，可能涉及人身安全保护相关措施" },
  ]
}

export function supplementDivorceDamageClaim(
  claims: Array<{ claim: string; confidence: string; reason: string }>,
  userText: string,
): Array<{ claim: string; confidence: string; reason: string }> {
  const hasViolence = hasDomesticViolenceIntent(userText)
  const hasInfidelity = hasInfidelityIntent(userText)
  if (!hasViolence && !hasInfidelity) return claims

  const hasDivorceClaim = claims.some((c) => c.claim.includes("离婚") || c.claim.includes("解除婚姻"))
  const hasDivorceIntent = detectDivorceIntent(userText)
  if (!hasDivorceClaim && !hasDivorceIntent) return claims

  const hasDamageClaim = claims.some((c) => c.claim.includes("损害赔偿") || c.claim.includes("离婚损害"))
  if (hasDamageClaim) return claims

  const reason = hasViolence
    ? "用户描述存在家暴情形，可能涉及离婚损害赔偿，需结合证据进一步判断"
    : "用户描述的婚内过错情形可能涉及离婚损害赔偿，需结合证据进一步判断"
  console.log("[supplementDivorceDamageClaim]", hasViolence ? "violence" : "infidelity", "+ divorce → adding divorce damage compensation")
  return [
    ...claims,
    { claim: "离婚损害赔偿", confidence: "medium", reason },
  ]
}

export function supplementInfidelityClaim(
  claims: Array<{ claim: string; confidence: string; reason: string }>,
  userText: string,
): Array<{ claim: string; confidence: string; reason: string }> {
  if (!hasInfidelityIntent(userText)) return claims

  const hasInfidelityClaim = claims.some(
    (c) => c.claim.includes("出轨") || c.claim.includes("婚内过错") || c.claim.includes("第三者")
  )
  if (hasInfidelityClaim) return claims

  console.log("[supplementInfidelityClaim] infidelity detected, adding fallback. matched:", userText.match(INFIDELITY_PATTERNS))
  return [
    ...claims,
    { claim: "出轨 / 婚内过错", confidence: "high", reason: "用户描述配偶存在情人、第三者或婚外关系，可能涉及婚内过错" },
  ]
}

export function supplementThirdPartyGiftClaim(
  claims: Array<{ claim: string; confidence: string; reason: string }>,
  userText: string,
): Array<{ claim: string; confidence: string; reason: string }> {
  if (!hasInfidelityIntent(userText)) return claims
  if (!hasThirdPartySpendingIntent(userText)) return claims

  const hasGiftClaim = claims.some(
    (c) => c.claim.includes("追回配偶赠与第三者") || c.claim.includes("第三者赠与")
  )
  if (hasGiftClaim) return claims

  const isSpecific = hasSpecificThirdPartySpending(userText)
  console.log("[supplementThirdPartyGiftClaim] third-party spending detected, specific:", isSpecific, "matched:", userText.match(THIRD_PARTY_SPENDING_PATTERNS))
  return [
    ...claims,
    {
      claim: "追回配偶赠与第三者的夫妻共同财产",
      confidence: isSpecific ? "high" : "medium",
      reason: isSpecific
        ? "用户描述配偶向情人或第三者支出、转账或赠与财产，可能涉及夫妻共同财产追回问题"
        : "用户描述配偶出轨并向他人转账，可能涉及向第三者赠与夫妻共同财产的问题，需进一步确认转账对象身份",
    },
  ]
}

/**
 * 统一诉求命名：
 * - 财产类：当"财产分割"+"房产分割"同时存在或只有"房产分割"时，统一为"财产分割 / 房产处理"
 * - 家暴类：将"家暴"/"人身安全保护令"/"保护令"等合并为"家暴 / 人身安全保护"
 * - 出轨类：将"出轨"/"婚外情"/"第三者"等合并为"出轨 / 婚内过错"
 */
export function normalizeClaimNames(
  claims: Array<{ claim: string; confidence: string; reason: string }>,
): Array<{ claim: string; confidence: string; reason: string }> {
  const confidenceOrder: Record<string, number> = { high: 3, medium: 2, low: 1 }
  let result = [...claims]

  // ── 财产类合并：财产分割 + 房产分割 → 财产分割 / 房产处理 ──
  const hasPropertyDivision = result.some((c) => c.claim === "财产分割")
  const hasHouseDivision = result.some((c) => c.claim === "房产分割")

  if (hasPropertyDivision && hasHouseDivision) {
    const propertyClaim = result.find((c) => c.claim === "财产分割")!
    const houseClaim = result.find((c) => c.claim === "房产分割")!
    const mergedConf = confidenceOrder[propertyClaim.confidence] >= confidenceOrder[houseClaim.confidence]
      ? propertyClaim.confidence : houseClaim.confidence
    result = result.filter((c) => c.claim !== "财产分割" && c.claim !== "房产分割")
    result.push({
      claim: "财产分割 / 房产处理",
      confidence: mergedConf,
      reason: "用户描述婚后房产及共同财产问题，可能涉及夫妻共同财产及房产处理",
    })
    console.log("[normalizeClaimNames] merged 财产分割 + 房产分割 → 财产分割 / 房产处理")
  } else if (hasHouseDivision && !hasPropertyDivision) {
    const houseClaim = result.find((c) => c.claim === "房产分割")!
    result = result.filter((c) => c.claim !== "房产分割")
    result.push({
      claim: "财产分割 / 房产处理",
      confidence: houseClaim.confidence,
      reason: houseClaim.reason || "用户描述涉及房产问题，可能涉及房产处理及财产分割",
    })
    console.log("[normalizeClaimNames] normalized standalone 房产分割 → 财产分割 / 房产处理")
  }

  // ── 家暴类合并：家暴/人身安全保护令 → 家暴 / 人身安全保护 ──
  const violenceKeywords = ["家暴", "人身安全保护令", "人身安全保护", "保护令"]
  const violenceClaims = result.filter((c) =>
    violenceKeywords.some((kw) => c.claim.includes(kw)) && !c.claim.includes("家暴 / 人身安全保护")
  )

  if (violenceClaims.length > 0) {
    const best = violenceClaims.sort(
      (a, b) => (confidenceOrder[b.confidence] || 0) - (confidenceOrder[a.confidence] || 0)
    )[0]

    const mergedClaim = {
      claim: "家暴 / 人身安全保护",
      confidence: best.confidence,
      reason: "用户描述存在家庭暴力、威胁或人身安全风险，可能涉及人身安全保护相关措施",
    }

    result = result.filter(
      (c) => !violenceKeywords.some((kw) => c.claim.includes(kw)) || c.claim === "家暴 / 人身安全保护"
    )
    const hasViolenceMerged = result.some((c) => c.claim === "家暴 / 人身安全保护")
    result = hasViolenceMerged
      ? result.map((c) => (c.claim === "家暴 / 人身安全保护" ? mergedClaim : c))
      : [...result, mergedClaim]

    console.log("[normalizeClaimNames] violence claims:", violenceClaims.map(c => c.claim), "→ merged into: 家暴 / 人身安全保护")
  }

  // ── 出轨类合并：出轨/婚外情/第三者 → 出轨 / 婚内过错 ──
  const infidelityKeywords = ["出轨", "婚内过错", "婚外情", "第三者", "婚外关系"]
  const infidelityClaims = result.filter((c) =>
    infidelityKeywords.some((kw) => c.claim.includes(kw)) &&
    c.claim !== "出轨 / 婚内过错" &&
    c.claim !== "追回配偶赠与第三者的夫妻共同财产"
  )

  if (infidelityClaims.length > 0) {
    const bestInfidelity = infidelityClaims.sort(
      (a, b) => (confidenceOrder[b.confidence] || 0) - (confidenceOrder[a.confidence] || 0)
    )[0]

    const mergedInfidelityClaim = {
      claim: "出轨 / 婚内过错",
      confidence: bestInfidelity.confidence,
      reason: "用户描述配偶存在情人、第三者或婚外关系，可能涉及婚内过错",
    }

    result = result.filter(
      (c) => !infidelityKeywords.some((kw) => c.claim.includes(kw)) || c.claim === "出轨 / 婚内过错"
    )
    const hasInfidelityMerged = result.some((c) => c.claim === "出轨 / 婚内过错")
    result = hasInfidelityMerged
      ? result.map((c) => (c.claim === "出轨 / 婚内过错" ? mergedInfidelityClaim : c))
      : [...result, mergedInfidelityClaim]

    console.log("[normalizeClaimNames] infidelity claims:", infidelityClaims.map(c => c.claim), "→ merged into: 出轨 / 婚内过错")
  }

  return result
}

// 第一轮低信息输入检测 — 模糊意图、情绪宣泄、缺具体事实
export const LOW_INFO_DIVORCE_PATTERNS = [
  /我想离婚/, /我想分开/, /我想离/,
  /想离婚/, /想离/, /我要离婚/, /我要离/,
  /过不下去/, /想离开/, /想跟他/, /想跟她/,
  /不想过了/, /不想跟他过了/, /不想跟她过了/,
  /想结束.*婚姻/, /婚姻.*走不下去/,
  /感情不和/, /我不想继续/,
]

export const CONCRETE_FACT_PATTERNS = [
  /子女/, /孩子/, /小孩/, /儿子/, /女儿/,
  /财产/, /出轨/, /家暴/, /债务/, /欠债/, /贷款/, /抚养/,
  /房产/, /房子/, /存款/, /工资/, /收入/,
  /暴力/, /虐待/, /动手/, /打了/, /打我/, /殴打/,
  /威胁/, /恐吓/, /伤害/, /报警/, /验伤/,
  /小三/, /第三者/, /婚外情/, /情人/, /冷暴力/,
  /赔偿/, /探望/, /探视/,
  /偷偷转走/, /转走.*钱/, /转账/, /转钱/, /转移财产/, /隐匿财产/,
  /取走钱/, /把钱转走/, /大额转账/, /异常转账/,
  /给别人转钱/, /给别人转账/, /存款转走/, /偷偷转钱/,
  /追回/, /要回来/, /拿回来/, /返还/,
  /钱/, /偷偷转账/, /转走了/,
  /分财产/, /分割财产/, /婚后.*房/, /买房/, /购房/, /分居/,
  /重婚/, /与他人同居/,
]

// 强情绪关键词 — 情绪宣泄但缺乏法律事实
export const EMOTION_KEYWORDS = [
  "好难过", "难过", "受不了", "受够了", "撑不住", "撑不下去",
  "过不下去", "不想活", "痛苦", "崩溃",
  "不知道怎么办", "不知道该怎么办", "不知道要怎么", "不知道该怎么",
  "想逃离", "想逃", "想离开", "想分开",
  "真的很累", "好累", "心累",
  "绝望", "无助", "折磨",
]

export const LEGAL_FACT_KEYWORDS = [
  "孩子", "子女", "抚养权", "抚养费",
  "房产", "财产", "债务", "出轨", "家暴",
  "分居", "结婚", "领证", "暴力", "虐待",
  "第三者", "婚外情", "情人", "有情人", "出轨", "小三", "赔偿", "探望", "探视",
  "买房", "购房", "一套房", "房贷", "房产证",
  "动手", "打我", "殴打", "威胁", "恐吓", "伤害", "报警", "验伤",
  "偷偷转走", "转走", "转账", "转钱", "转移财产", "隐匿财产", "给别人转钱",
  "重婚", "与他人同居",
  "取走钱", "追回", "要回来", "拿回来", "返还", "钱", "偷偷转账",
]

export function detectEmotionLowInfo(userInput: string): boolean {
  const hasEmotion = EMOTION_KEYWORDS.some((kw) => userInput.includes(kw))
  const hasLegalFact = LEGAL_FACT_KEYWORDS.some((kw) => userInput.includes(kw))
  return hasEmotion && !hasLegalFact
}

export function getLowInfoGuidanceMessage(): string {
  return "我理解你现在可能正处在很痛苦、很混乱的状态。没关系，我们先不用急着下结论，也不用一次把所有事情说完整。\n\n你可以慢慢告诉我：这段婚姻里最让你想离开的原因是什么？比如感情不和、长期分居、孩子问题、财产问题、出轨、家暴，或其他让你难以承受的情况。\n\n我会根据你补充的信息，帮你整理可能涉及的诉求，并生成去律所咨询前可以准备的材料清单。"
}

export function detectMentionedClaims(fullUserText: string): string[] {
  const found: string[] = []
  for (const { claim, patterns } of MENTION_PATTERNS) {
    if (patterns.some((p) => p.test(fullUserText))) {
      found.push(claim)
    }
  }
  return found
}

export function buildSmartFollowUp(
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

/**
 * 显式置信度规则：用户明确表达某诉求时，升级 confidence 为 high
 */
export const EXPLICIT_CONFIDENCE_RULES: Array<{
  claimPattern: RegExp
  textPatterns: RegExp[]
  reason: string
}> = [
  {
    claimPattern: /^离婚$|解除婚姻/,
    textPatterns: [/我想离婚/, /想离婚/, /我要离婚/, /准备离婚/, /想分开/, /不想过了/, /过不下去/, /想离/],
    reason: "用户明确表达离婚意愿",
  },
  {
    claimPattern: /抚养权/,
    textPatterns: [/争夺抚养权/, /争抚养权/, /想要抚养权/, /想.*抚养权/, /孩子.*跟我/, /孩子.*归我/, /想.*孩子.*生活/, /孩子.*谁带/, /要孩子/],
    reason: "用户明确表达希望争取子女抚养权",
  },
  {
    claimPattern: /抚养费/,
    textPatterns: [/要抚养费/, /想要抚养费/, /主张抚养费/, /要求抚养费/, /抚养费/],
    reason: "用户明确表达抚养费诉求",
  },
  {
    claimPattern: /财产分割|房产分割|共同财产/,
    textPatterns: [/分财产/, /分割财产/, /财产分割/, /分房子/, /分房产/, /婚后财产/, /共同财产/, /房子怎么分/, /跟他分财产/, /想.*分.*房/],
    reason: "用户明确表达希望处理财产分割",
  },
  {
    claimPattern: /损害赔偿|保护令/,
    textPatterns: [/要求赔偿/, /主张赔偿/, /想要赔偿/, /索赔/, /申请.*保护令/],
    reason: "用户明确表达赔偿/保护令诉求",
  },
  {
    claimPattern: /探望|探视/,
    textPatterns: [/想.*探望/, /想.*探视/, /要探望/, /要探视/, /主张探望/, /主张探视/],
    reason: "用户明确表达探望权诉求",
  },
  {
    claimPattern: /^出轨 \/ 婚内过错$/,
    textPatterns: [/出轨/, /有情人/, /情人/, /外面有人/, /外面有女人/, /外面有男人/, /小三/, /第三者/, /婚外情/, /婚外关系/, /和别人同居/, /跟别人同居/, /暧昧对象/, /约会别人/],
    reason: "用户描述配偶存在情人、第三者或婚外关系，可能涉及婚内过错",
  },
  {
    claimPattern: /追回配偶赠与第三者的夫妻共同财产/,
    textPatterns: [/给情人花钱/, /给情人转钱/, /给第三者花钱/, /给第三者转钱/, /给小三花钱/, /给小三转钱/, /给情人买东西/, /给小三买东西/, /给第三者买房/, /给第三者买车/],
    reason: "用户描述配偶向情人或第三者支出、转账或赠与财产，可能涉及夫妻共同财产追回问题",
  },
  {
    claimPattern: /债务处理/,
    textPatterns: [/债务/, /欠债/, /借款/, /贷款/, /还债/],
    reason: "用户明确提到家庭债务或债务责任分担问题",
  },
  {
    claimPattern: /出轨|家暴|婚外情|暴力|虐待/,
    textPatterns: [/出轨/, /家暴/, /婚外情/, /打我/, /虐待/, /暴力/, /威胁/],
    reason: "用户明确描述相关事实",
  },
]

export function normalizeClaimConfidence(
  claims: Array<{ claim: string; confidence: string; reason: string }>,
  userText: string,
): Array<{ claim: string; confidence: string; reason: string }> {
  return claims.map((c) => {
    if (c.confidence === "high") return c
    for (const rule of EXPLICIT_CONFIDENCE_RULES) {
      if (rule.claimPattern.test(c.claim)) {
        if (rule.textPatterns.some((p) => p.test(userText))) {
          console.log(`[normalizeClaimConfidence] Upgrading "${c.claim}" confidence: ${c.confidence} → high`)
          return { ...c, confidence: "high", reason: rule.reason }
        }
        break
      }
    }
    return c
  })
}

/**
 * 有效诉求白名单 — 不在白名单内的 claim 会被过滤
 */
export const VALID_CLAIM_WHITELIST = [
  "离婚",
  "子女抚养权",
  "抚养费",
  "探望权",
  "财产分割",
  "房产分割",
  "财产分割 / 房产处理",
  "财产转移",
  "追回财产",
  "债务处理",
  "出轨 / 婚内过错",
  "家暴 / 人身安全保护",
  "离婚损害赔偿",
  "追回配偶赠与第三者的夫妻共同财产",
]

const INVALID_CLAIM_PLACEHOLDERS = [
  "...", "……", "无", "未识别", "未知",
  "婚姻问题", "家庭问题", "感情问题", "法律问题", "纠纷", "婚姻家事", "情感困扰",
]

export interface PossibleClaim {
  claim: string
  confidence: string
  reason: string
}

export function isValidClaim(c: PossibleClaim): boolean {
  if (!c || typeof c !== "object") return false

  const claim = (c.claim || "").trim()
  if (!claim) return false

  // 占位符/无效标签
  if (INVALID_CLAIM_PLACEHOLDERS.some((p) => claim === p || claim.includes(p) || p.includes(claim))) return false

  // confidence 不能是占位符
  if (c.confidence === "..." || c.confidence === "……") return false

  // 白名单匹配（精确匹配或包含匹配）
  const inWhitelist = VALID_CLAIM_WHITELIST.some(
    (w) => claim === w || claim.includes(w) || w.includes(claim)
  )
  if (!inWhitelist) {
    console.log("[isValidClaim] FILTERED invalid claim:", JSON.stringify(c))
    return false
  }

  return true
}

/**
 * 统一的诉求清洗与兜底 Pipeline
 * 步骤：过滤无效标签 → 子女抚养权 → 抚养费 → 离婚 → 财产转移 → 财产分割/房产 → 家暴 → 离婚损害赔偿 → 出轨 → 第三者赠与 → 追回去重 → 命名统一 → 置信度标准化 → isValidClaim → 排除过滤
 */
export function runClaimPipeline(
  difyClaims: Array<{ claim: string; confidence: string; reason: string }>,
  accumulatedText: string,
  excludedClaims: string[],
): Array<{ claim: string; confidence: string; reason: string }> {
  // 1. 过滤掉大类/无效诉求标签
  const INVALID_LABELS = ["婚姻问题", "家庭问题", "感情问题", "法律问题", "纠纷", "婚姻家事", "情感困扰"]
  let claims = (difyClaims || []).filter(c =>
    c && c.claim && !INVALID_LABELS.some(il => c.claim.includes(il) || il.includes(c.claim))
  )

  // 2. 子女抚养权兜底
  claims = supplementChildrenClaim(claims, accumulatedText)

  // 2.5 抚养费兜底（未成年子女 + 抚养安排上下文）
  claims = supplementChildSupportClaim(claims, accumulatedText)

  // 3. 离婚兜底
  const hasDivorceIntent = detectDivorceIntent(accumulatedText)
  claims = ensureBaseDivorceClaim(claims, hasDivorceIntent)

  // 4. 财产转移兜底
  claims = supplementPropertyTransferClaim(claims, accumulatedText)

  // 5. 财产分割兜底
  claims = supplementPropertyDivisionClaim(claims, accumulatedText)

  // 5.5 债务处理兜底
  claims = supplementDebtClaim(claims, accumulatedText)

  // 6. 家暴兜底
  claims = supplementDomesticViolenceClaim(claims, accumulatedText)

  // 7. 离婚损害赔偿兜底（需家暴 + 离婚意愿）
  claims = supplementDivorceDamageClaim(claims, accumulatedText)

  // 8. 出轨/婚内过错兜底
  claims = supplementInfidelityClaim(claims, accumulatedText)

  // 9. 第三者赠与追回兜底（需出轨 + 财产支出）
  claims = supplementThirdPartyGiftClaim(claims, accumulatedText)

  // 9.5 去重：第三者赠与场景下，优先保留具体的"追回配偶赠与第三者的夫妻共同财产"，移除泛化的"追回财产"
  if (claims.some(c => c.claim === "追回配偶赠与第三者的夫妻共同财产")) {
    const before = claims.length
    claims = claims.filter(c => c.claim !== "追回财产")
    if (claims.length < before) {
      console.log("[runClaimPipeline] dedup: removed 追回财产 (replaced by 追回配偶赠与第三者的夫妻共同财产)")
    }
  }

  // 10. 统一命名：合并"家暴"/"人身安全保护令"等为"家暴 / 人身安全保护"，合并"出轨"/"婚外情"等为"出轨 / 婚内过错"
  claims = normalizeClaimNames(claims)

  // 11. 置信度标准化：用户明确表达的诉求升级为 high
  claims = normalizeClaimConfidence(claims, accumulatedText)

  // 12. 过滤无效/占位符诉求
  claims = claims.filter(isValidClaim)

  console.log("[runClaimPipeline] input:", difyClaims.map(c => c.claim), "→ output:", claims.map(c => c.claim))

  // 13. 过滤已排除的诉求
  return claims.filter(c => !excludedClaims.some(ex => c.claim.includes(ex) || ex.includes(c.claim)))
}
