---
name: art-directed-product
description: Art-direct new or substantially redesigned product interfaces. Use when establishing a visual direction, designing a page or flow, or when a UI prototype needs distinct visual candidates.
compatibility: Requires filesystem access. Integrates with the model-invoked grilling and prototype skills when available.
disable-model-invocation: true
---

# Art-Directed Product

Work **contract-first**: ground design decisions in the product, resolve blocking uncertainty, then spend boldness on one defensible signature.

## Precedence

Resolve conflicts in this order:

1. Explicit user requirements
2. Accessibility, usability, semantics, and truthful content
3. Product purpose, audience, and primary job
4. Coherent art direction
5. Cinematic techniques
6. Random variation

A lower level never overrules a higher one.

## 1. Inspect

Find the product root and read existing evidence before asking questions:

- `ART-DIRECTED-PRODUCT.md`, if present
- Product briefs, requirements, routes, and representative screens
- Design tokens, component libraries, fonts, assets, and content
- Framework, browser support, accessibility, and performance constraints
- Relevant user preferences already present in the conversation or repository

For a monorepo, use the root of the product containing the affected surface. If several products remain plausible, that scope is blocking.

Classify unknowns:

- **Discoverable:** answer through repository legwork.
- **Assumable:** propose a concrete assumption and record it.
- **Blocking:** a wrong answer could materially change audience, behavior, content, brand, platform, or success.
- **Deferred:** does not affect the current surface.

**Complete when:** every discoverable item has been answered or linked to its source, and every remaining unknown has exactly one classification.

## 2. Pass the readiness gate

The contract needs enough evidence to state:

- Product and affected surface
- Audience and context of use
- The surface's single primary job
- Essential content, data, and actions
- Success criteria
- Brand and product constraints
- Existing system and technical constraints
- Accessibility baseline
- Intended visual and motion character, whether supplied or proposed

Aesthetic freedom is assumable when the user has delegated art direction. Product behavior and consequential business claims are not.

If blocking decisions remain, run the model-invoked `grilling` skill—the agent-reachable counterpart of `/grill-me`. Ask one decision per turn, recommend an answer, resolve dependencies in order, and inspect facts instead of asking for them. Design work remains paused until the user confirms shared understanding.

**Complete when:** no blocking item is unresolved and, when grilling was required, the user has explicitly confirmed readiness.

## 3. Establish the contract

Create or update `<product-root>/ART-DIRECTED-PRODUCT.md` using [the contract template](references/contract-template.md). Preserve valid prior decisions. Revise a decision only when new evidence explains why; record the change in the decision log.

Use pointers to existing token, component, content, and requirements files instead of copying their contents. Keep temporary implementation notes outside the contract.

Set the contract to `Ready` only after the readiness gate passes. Record assumptions as assumptions, not facts.

**Complete when:** the contract exists at the product root, has no blocking `TBD`, identifies one signature, and is internally consistent with repository evidence.

## 4. Choose one branch

### Direct design

Use when the contract supports one defensible direction and alternatives would not resolve a meaningful uncertainty.

Read [design foundations](references/design-foundations.md), then only the relevant entries in the [cinematic arsenal](references/cinematic-arsenal.md). Implement the selected direction; derive visual and interaction choices from the contract.

### UI prototype

Use when the user requests alternatives or a high-impact question about hierarchy, composition, or interaction remains unresolved. Run the `prototype` skill's UI branch. Then read [prototype divergence](references/prototype-divergence.md) and use its deterministic provocations to diversify candidates.

Randomization belongs only to this UI-prototype branch. It constrains candidate exploration; it never chooses the winner. Logic prototypes do not use it.

**Complete when:** exactly one branch is active and its reason is stated. For prototypes, each candidate tests the same question while differing structurally from the others.

## 5. Critique and verify

Apply every relevant check in [quality gates](references/quality-gates.md). Inspect the result in a real browser at representative mobile and desktop sizes when the project can run. Revise the most generic-looking decision, then remove one effect that competes with the signature.

When a prototype resolves the question, record the winner, borrowed elements, evidence, and rationale in the contract. Follow the prototype skill's capture and cleanup process; prototype code does not become production code unchanged.

**Complete when:** every quality gate is `PASS` or justified `N/A`, the signature remains dominant, and validated decisions are recorded in `ART-DIRECTED-PRODUCT.md`.
