---
name: legal-claim-agent-ux
description: Use this skill when modifying product logic, user flow, emotional input handling, claim discovery, claim confirmation, evidence checklist generation, Dify app calling rules, or UX copy for the AI legal claim discovery and evidence preparation assistant.
---

# Legal Claim Agent UX Skill

## 1. Product Positioning

This project is an AI legal claim discovery and evidence preparation assistant for marriage and family disputes.

It is NOT:
- a legal advice AI
- a lawyer replacement
- a judgment prediction tool
- a formal legal consultation system

It IS:
- a claim discovery assistant
- an emotional low-information input handler
- a user-confirmed claim organizer
- an evidence preparation checklist generator before visiting a law firm

Core product value:

messy / emotional / non-professional user expression
→ discover possible legal claims
→ let the user confirm or exclude claims
→ generate a preparation checklist for law firm consultation

The assistant should help users organize what they may want to claim and what materials they may need to prepare. It should not make final legal judgments.

---

## 2. Core Flow

The frontend must follow a strict three-step flow:

### Step 1: discovery

Goal:
- collect user description
- handle emotional or low-information input
- identify possible legal claims

Allowed:
- local emotional support response
- calling Intent Discovery App
- light follow-up questions

Not allowed:
- calling Analysis/Evidence App
- generating final evidence checklist
- treating broad categories as claims

### Step 2: confirmation

Goal:
- display possible claims as selectable cards
- allow the user to select or unselect claims
- allow the user to add more facts
- allow the user to exclude claims

Allowed:
- updating possibleClaims
- updating selectedClaims
- updating excludedClaims
- re-running Intent Discovery if user adds new facts

Not allowed:
- calling Analysis/Evidence App unless the user clicks confirm
- jumping back to discovery without reason
- repeating the same follow-up question

### Step 3: evidence

Goal:
- call Analysis/Evidence App
- generate evidence preparation checklist
- show checklist in clear sections

Allowed:
- evidence checklist rendering
- user manual checklist ticking
- risk notes about legal evidence collection

Not allowed:
- giving formal legal conclusions
- predicting case results
- default-checking all evidence items
- showing blank evidence cards

---

## 3. Concrete Claim Rules

Only concrete legal claims can enter user confirmation.

Valid claim examples:

- 离婚
- 协议离婚
- 诉讼离婚
- 子女抚养权
- 抚养费
- 探望权
- 财产分割
- 房产分割
- 财产转移
- 隐匿财产
- 债务处理
- 出轨 / 婚内过错
- 家暴 / 人身安全保护
- 离婚损害赔偿
- 追回配偶赠与第三者的夫妻共同财产

Invalid claim examples:

- 婚姻问题
- 家庭问题
- 感情问题
- 法律问题
- 纠纷
- 婚姻家事
- 情感困扰

Important rule:

"婚姻问题" is a domain/category, not a claim.  
Never display it as a possible claim.  
Never put it into selectedClaims.  
Never let it enter the confirmation stage.

If only a domain is detected but no concrete claim is found, use emotional support or light guidance instead of claim confirmation.

---

## 4. Emotional Low-Information Input Rules

If the user inputs strong emotional expressions but no concrete legal facts, do not call Dify.

Examples:

- 我好痛苦
- 我真的好难过
- 我过不下去了
- 我受不了了
- 我撑不住了
- 我不知道怎么办
- 我想离开他/她
- 我想离婚
- 感情不和
- 我不想继续了

If the input has no concrete facts such as:

- 子女
- 抚养权
- 抚养费
- 财产
- 房产
- 债务
- 出轨
- 家暴
- 分居
- 结婚
- 领证

Then use this local response template:

我理解你现在可能正处在很痛苦、很混乱的状态。没关系，我们先不用急着下结论，也不用一次把所有事情说完整。

你可以慢慢告诉我：这段婚姻里最让你想离开的原因是什么？比如感情不和、长期分居、孩子问题、财产问题、出轨、家暴，或其他让你难以承受的情况。

我会根据你补充的信息，帮你整理可能涉及的诉求，并生成去律所咨询前可以准备的材料清单。

Rules:
- Do not add "如果没有，可以说没有" to the first-turn low-information response.
- Do not show Dify API errors to the user for this case.
- Do not enter confirmation.
- Do not generate fallback claims like "婚姻问题".

---

## 5. Multi-turn Conversation Rules

The assistant is not a free-form chatbot. It is a guided claim discovery flow.

### accumulatedUserInput

Maintain accumulatedUserInput as the full user case description.

The UI chat messages and accumulatedUserInput are different:
- messages: display chat history
- accumulatedUserInput: send to Dify for claim discovery and evidence generation

### User adds new facts

If the user continues typing in confirmation stage:

- append the new input to accumulatedUserInput
- call Intent Discovery App again only if the input contains new facts
- merge new possible claims
- keep selectedClaims when reasonable
- filter excludedClaims
- stay in confirmation stage

Do not call Analysis/Evidence App until the user clicks confirm.

### User says "没有 / 不涉及"

If the user says:

- 没有
- 没了
- 不涉及
- 暂时没有
- 没有其他
- 就这些
- 就这个
- 只要这个
- 不涉及其他

Interpret it based on lastFollowUpTopics.

Do not treat it as a new legal fact.  
Do not clear all claims.  
Do not repeatedly ask the same question.

If possibleClaims already contains at least one concrete claim, move to or stay in confirmation.

If possibleClaims is empty, show:

我目前还没有识别出明确诉求。您可以补充一句，例如：我想离婚 / 想要抚养权 / 有财产纠纷。

### User rejects a claim

If the user says:

- 不想
- 不要
- 不主张
- 不处理
- 暂时不考虑
- 不争
- 不需要

then identify the related claim and add it to excludedClaims.

Examples:
- 我不想财产分割 → exclude 财产分割
- 我不要抚养费 → exclude 抚养费
- 我不争房子 → exclude 房产分割 / 财产分割
- 我只想离婚，不想争财产 → keep 离婚, exclude 财产分割
- 孩子抚养权我不要争 → exclude 子女抚养权

When a claim is excluded:
- remove it from possibleClaims
- remove it from selectedClaims
- do not send it to Analysis/Evidence App
- do not ask follow-up questions about it again

---

## 6. Follow-up Question Rules

Follow-up questions should be light and claim-oriented.

Do not ask like a lawyer intake form.

Bad:
- 对方收入是多少？
- 房产登记在谁名下？
- 是否有分居证据？
- 是否有银行流水？
- 房产、存款、车辆、债务是否都要处理？

Good:
- 我已经记录到：离婚、抚养权。除了这两个，是否还涉及财产、抚养费、出轨或家暴等问题？
- 我理解你主要想处理离婚。除了离婚本身，是否还涉及孩子、财产或人身安全问题？
- 如果还有其他情况需要补充，可以直接继续输入，我会重新帮你整理可能诉求。

Rules:
- Ask at most 1–2 follow-up directions at a time.
- Do not ask about already recognized claims.
- Do not ask about excluded claims.
- Do not repeat lastFollowUpQuestion.
- Do not show placeholders like "问题1 / 问题2 / 问题3".
- If no useful follow-up direction remains, enter confirmation.

---

## 7. Confirmation Stage Rules

In confirmation stage, show possible claims as selectable cards.

Each claim card should include:
- claim name
- confidence
- reason
- checkbox

Default selection:
- high and medium confidence claims can be preselected
- low confidence claims should usually be unselected unless product logic says otherwise

Add this helper text in confirmation stage:

如果还有其他情况需要补充，可以直接在下方聊天框继续输入，我会重新帮你整理可能诉求。

Rules:
- User can manually unselect claims.
- User can add new facts.
- User can exclude claims.
- Analysis/Evidence App is called only when user clicks "确认诉求并生成证据清单".
- If user adds facts, re-run Intent Discovery and update claims.
- Stay in confirmation stage after updates.

---

## 8. Evidence Checklist Rules

Evidence checklist is the final product output.

It should help the user prepare before visiting a law firm.

It should not sound like formal legal advice.

Evidence sections:

- priority_evidence
- general_evidence
- missing_evidence
- risk_notes
- lawyer_visit_checklist

Rules:
- Checklist items must be unchecked by default.
- The user manually checks items they already have.
- Do not default-check all items.
- Do not render empty evidence cards.
- Filter items with no valid item/title/name/material/evidence_name.
- Risk notes should not have checkboxes.
- Lawyer visit checklist can have checkboxes but should be unchecked by default.
- Do not output case outcome predictions.
- Do not promise success.
- Do not use absolute phrases like "净身出户".
- Do not say "一定可以追回".
- Use cautious wording like "可向律师咨询是否需要...".

Good risk note:
如担心对方转移财产，可向律师咨询是否需要采取财产保全等措施。

Bad risk note:
应立即申请财产保全。

---

## 9. Dify API Calling Rules

There are two Dify Apps.

### Intent Discovery App

Purpose:
- discover possible claims from accumulatedUserInput

Request body:

{
  "inputs": {},
  "query": accumulatedUserInput,
  "response_mode": "blocking",
  "user": "demo-user"
}

Rules:
- query must be a string
- use only in discovery or confirmation when user adds new facts
- do not call for first-turn emotional low-information input
- do not call Analysis/Evidence App here

### Analysis/Evidence App

Purpose:
- generate evidence checklist based on confirmed claims

Request body:

{
  "inputs": {
    "confirmed_claims": "selected claims joined by comma"
  },
  "query": accumulatedUserInput,
  "response_mode": "blocking",
  "user": "demo-user"
}

Rules:
- call only after user clicks confirm
- confirmed_claims must be inside inputs
- do not call if selectedClaims is empty
- do not call during ordinary multi-turn typing
- do not call during emotional support response

---

## 10. Forbidden Behaviors

Never do these:

- Do not treat "婚姻问题" as a claim.
- Do not use broad domain labels as possibleClaims.
- Do not show "问题1 / 问题2 / 问题3".
- Do not repeat the same follow-up question.
- Do not call Analysis/Evidence App before user confirmation.
- Do not show Dify API raw errors directly to the user.
- Do not send first-turn emotional low-information input to Dify.
- Do not clear all claims when the user says "没有".
- Do not ignore user negation such as "我不想财产分割".
- Do not default-check evidence items.
- Do not render blank evidence cards.
- Do not write formal legal conclusions.
- Do not promise case results.
- Do not replace lawyer judgment.

---

## 11. Preferred UX Tone

Tone should be:
- calm
- respectful
- warm
- non-judgmental
- professional
- not overly legalistic
- not overly emotional

Avoid:
- bureaucratic wording
- exaggerated promises
- cold form-like questioning
- heavy legal conclusions

Good tone:
我理解你现在可能正处在很痛苦、很混乱的状态。我们先不用急着下结论，可以一步一步把情况梳理清楚。

Bad tone:
用户您好，我方将竭尽全力帮助您维护法律权益。

---

## 12. Before Making Changes

Before modifying code, ask internally:

1. Is this a product logic change, React state change, or data parsing change?
2. Which step does it affect: discovery, confirmation, or evidence?
3. Should Dify be called here?
4. Is the user expressing emotion, adding facts, confirming claims, or excluding claims?
5. Will this create repeated follow-up questions?
6. Could this accidentally treat a domain as a claim?
7. Could this make the assistant sound like a lawyer replacement?

If the change affects React state, also consider react-state-machine skill.

If the change affects API parsing or data normalization, also consider typescript-data-safety skill.

---

## 13. Minimal Change Rule

Make minimal necessary changes.

Do not rewrite the whole app unless explicitly asked.

Do not change:
- Dify API keys
- Dify endpoints
- environment variable names
- project structure

unless explicitly requested.
