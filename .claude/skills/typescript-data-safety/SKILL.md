---
name: typescript-data-safety
description: Use this skill when fixing TypeScript errors, Dify API response parsing, JSON parsing, evidenceData normalization, possibleClaims normalization, undefined/null safety, empty card filtering, and runtime data validation.
---

# TypeScript Data Safety Skill

## Project Context

This project calls two Dify Apps:

1. Intent Discovery App
   - input: accumulatedUserInput
   - output: possible_claims

2. Analysis/Evidence App
   - input: accumulatedUserInput + confirmed_claims
   - output: evidence preparation checklist

Dify responses may be inconsistent. The frontend must normalize all external data before rendering.

## Important Types

Use or align with these types:

```ts
type Confidence = "high" | "medium" | "low"

type PossibleClaim = {
  claim: string
  confidence?: Confidence | string
  reason?: string
}

type EvidenceItem = {
  item: string
  reason?: string
  priority?: string
}

type EvidenceData = {
  confirmed_claims: string[]
  priority_evidence: EvidenceItem[]
  general_evidence: EvidenceItem[]
  missing_evidence: EvidenceItem[]
  risk_notes: string[]
  lawyer_visit_checklist: string[]
}
```
