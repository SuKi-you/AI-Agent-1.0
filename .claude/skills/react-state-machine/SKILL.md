---
name: react-state-machine
description: Use this skill when modifying the React frontend flow, multi-turn chat logic, currentStep state, possibleClaims, selectedClaims, excludedClaims, emotional low-information input handling, claim confirmation, and evidence checklist interaction.
---

# React State Machine Skill

## Project Context

This project is a React + Vite frontend for an AI legal claim discovery and evidence preparation assistant.

The product is not a free-form chatbot. It must follow a clear three-step product flow:

1. discovery
   - collect user description
   - handle emotional low-information input
   - identify possible legal claims

2. confirmation
   - display possible claims as selectable cards
   - allow the user to add more facts
   - allow the user to exclude claims
   - wait for user confirmation

3. evidence
   - call the Analysis/Evidence Dify App
   - render evidence preparation checklist

## Core State Rules

Keep these states separated:

- messages: only for chat UI display
- accumulatedUserInput: full case description sent to Dify
- currentStep: discovery | confirmation | evidence
- possibleClaims: claims discovered by AI
- selectedClaims: claims selected by user
- excludedClaims: claims explicitly rejected by user
- evidenceData: normalized evidence checklist data
- lastFollowUpQuestion: used to avoid repeated follow-up questions
- lastFollowUpTopics: used to interpret "没有" / "不涉及"
- isLoading / isSending: only for request or local response status

## Hard Rules

1. Never call the Analysis/Evidence App before the user clicks confirm.

2. Intent Discovery App is used only for claim discovery.

3. Analysis/Evidence App is used only after confirmation.

4. Do not treat "婚姻问题" as a claim. It is only a domain/category.

5. Only concrete claims can enter confirmation, such as:
   - 离婚
   - 子女抚养权
   - 抚养费
   - 财产分割
   - 财产转移
   - 出轨
   - 家暴
   - 离婚损害赔偿
   - 追回配偶赠与第三者的夫妻共同财产

6. If the user says:
   - 我好痛苦
   - 我过不下去了
   - 我受不了了
   - 我撑不住了
   - 我不知道怎么办

   and gives no concrete facts, do not call Dify. Use emotional support and gentle guidance.

7. If the user says:
   - 没有
   - 没了
   - 不涉及
   - 暂时没有
   - 没有其他
   - 就这些

   interpret it based on lastFollowUpTopics. Do not clear all claims.

8. If the user says:
   - 不想
   - 不要
   - 不主张
   - 不处理
   - 不争
   - 暂时不考虑

   add the corresponding claim to excludedClaims, remove it from possibleClaims and selectedClaims.

9. In confirmation step, if the user continues typing:
   - append the new input to accumulatedUserInput
   - rerun Intent Discovery only if it contains new facts
   - update possibleClaims
   - keep currentStep as confirmation
   - do not call Analysis/Evidence App

10. Checklist items must be unchecked by default.

11. Do not show fallback placeholders like:
   - 问题1
   - 问题2
   - 问题3

12. Left chat panel and right report panel should scroll independently.

## Emotional Low-Information Template

When first-turn emotional or low-information input is detected, use this template:

我理解你现在可能正处在很痛苦、很混乱的状态。没关系，我们先不用急着下结论，也不用一次把所有事情说完整。

你可以慢慢告诉我：这段婚姻里最让你想离开的原因是什么？比如感情不和、长期分居、孩子问题、财产问题、出轨、家暴，或其他让你难以承受的情况。

我会根据你补充的信息，帮你整理可能涉及的诉求，并生成去律所咨询前可以准备的材料清单。

Do not add "如果没有，可以说没有" to the first-turn low-information guidance.

## Before Editing

Before making code changes, identify:

1. Which step is currently affected?
2. Which state variables are involved?
3. Should Dify be called or should the response be local?
4. Does this change affect discovery, confirmation, or evidence?
5. Could this create duplicate follow-up questions?

## Preferred Fix Style

- Make minimal changes.
- Do not rewrite the whole app unless explicitly asked.
- Do not modify Dify API keys or endpoints.
- Avoid mixing UI display state with business flow state.
- If adding logs, keep them targeted and remove noisy logs after debugging.
