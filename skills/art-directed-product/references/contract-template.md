# Design Contract Template

Use this structure for `<product-root>/ART-DIRECTED-PRODUCT.md`. Replace guidance text; do not preserve empty boilerplate. Use `Not applicable — <reason>` when that is the truthful answer.

```markdown
# Art-Directed Product

Status: Draft | Ready
Last reviewed: YYYY-MM-DD
Scope: <product or package>

## Product thesis

- **Product:** <what it is>
- **Affected surface:** <page, route, flow, or component family>
- **Audience:** <who uses it and in what context>
- **Primary job:** <one outcome this surface must enable>
- **Success criteria:** <observable product and user outcomes>

## Required experience

### Content and data

<Essential information, content states, real data density, and source pointers.>

### Actions and states

<Primary action, secondary actions, loading, empty, error, success, permissions, and edge states that matter.>

### Constraints

- **Brand:** <fixed assets, voice, legal claims, existing recognition>
- **Technical:** <framework, component system, browser/device, performance>
- **Accessibility:** <baseline and surface-specific needs>
- **Source pointers:** <paths to authoritative requirements, tokens, components, and content>

## Art direction

- **Thesis:** <one sentence connecting the subject to the visual direction>
- **Desired qualities:** <3–5 specific qualities>
- **Signature:** <the one memorable element and why it serves the product>
- **Palette:** <roles and values, or pointer to authoritative tokens>
- **Typography:** <display, body, utility roles and rationale>
- **Composition:** <spatial and information-hierarchy model>
- **Imagery and material:** <authentic visual sources, treatment, and exclusions>
- **Motion character:** <restrained, expressive, or cinematic; purpose and limits>
- **Voice:** <register, vocabulary, and action-label conventions>

## Decision policy

### Invariants

<Properties every implementation must preserve: clarity, contrast, focus, semantics, truthful copy, responsiveness, reduced motion, and product-specific constraints.>

### Conditional patterns

<Patterns permitted only in named contexts, such as AIDA for a campaign surface or dense bento composition for comparable content.>

### Available techniques

<Optional techniques that fit this direction. These are an arsenal, not a quota.>

## Assumptions

- <assumption, why it is safe enough, and how it can be invalidated>

## Open decisions

### Blocking

None.

### Deferred

- <decision and the condition that makes it relevant>

## Validated decisions

| Date | Question | Decision | Evidence and rationale |
|---|---|---|---|
| YYYY-MM-DD | <what was unresolved> | <selected answer> | <prototype, user feedback, research, or observed constraint> |
```

## Readiness rules

`Ready` means:

- Product, surface, audience, primary job, content/actions, and success are concrete.
- Art direction names one signature rather than a collection of effects.
- Constraints and source pointers agree with the repository.
- `Open decisions / Blocking` says `None`.
- Assumptions are visible and falsifiable.

Keep exact implementation details in code unless they are durable design constraints. Record why a decision exists; avoid turning the contract into a changelog of CSS edits.
