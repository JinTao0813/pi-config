---
name: session-to-html
description: Turns discussions, brainstorming sessions, grilling sessions, long markdown/plans, or messy notes into a polished single-file HTML document that is detailed, scannable, and useful for decision-making. Use when the user asks to compile, document, summarize, convert, format, package, or turn planning context into HTML, brainstorm boards, strategy docs, PRD-style pages, prototype notes, design-system sketches, or readable handoff documents.
---

# Session to HTML

Create a self-contained HTML file that preserves the thinking, decisions, alternatives, and rationale from a messy conversation or markdown source while making it easy to read, share, and continue brainstorming.

## Output contract

Always produce a real `.html` file unless the user explicitly asks for inline code. Use single-file HTML with embedded CSS. No external CDNs unless user asks.

Default filename pattern:

```text
<topic-slug>-brainstorm.html
<topic-slug>-planning-board.html
<topic-slug>-decision-doc.html
```

## Workflow

1. **Collect source material**
   - Use current conversation first.
   - If user references files, read them.
   - If context is missing, ask only for the missing source or scope.
   - Do not invent decisions that were not made. Mark assumptions clearly.

2. **Extract structure**
   Capture:
   - core idea / thesis
   - target users
   - problem framing
   - required modules or non-negotiables
   - optional modules / stretch ideas
   - feature list with “why build this” rationale
   - user journeys / flows
   - MVP scope vs later scope
   - open questions
   - risks / trade-offs
   - data, AI, security, privacy, architecture notes
   - prototype screens or design-system ideas if discussed

3. **Choose document type**
   - Brainstorm board: broad idea capture, alternatives, open questions.
   - Planning board: MVP, roadmap, responsibilities, build order.
   - Decision doc: decisions, rationale, rejected options, next actions.
   - Prototype brief: screens, states, components, interaction notes.
   - Design-system sketch: tokens, layout rules, components, voice.

4. **Design for reading**
   - Use strong hierarchy, short sections, tables for comparisons, and compact feature blocks.
   - Each major feature should answer: what it is, why it exists, MVP priority.
   - Prefer calm, professional UI: subtle borders, readable type, restrained color.
   - Avoid generic AI UI: no gradient text, no glassmorphism, no fake metric grids, no oversized pill overload, no decorative fluff.
   - Make mobile responsive.
   - Use accessible contrast and semantic HTML.

5. **Write the file**
   - Use `write` for new files.
   - If editing existing generated HTML, use `edit` for targeted changes.
   - After writing, report path and short contents summary.

## Required sections for most outputs

Use these unless inappropriate:

```text
1. Title + short positioning statement
2. What we are building
3. Why this matters
4. Non-negotiables / compulsory scope
5. Core features, each with rationale
6. Optional / stretch features
7. User journey or demo flow
8. Screen or prototype map
9. Data / AI / architecture notes
10. Trust, privacy, safety, or quality notes
11. MVP scope
12. Later scope / do-not-build-yet
13. Open questions
14. Next actions
```

## Feature block pattern

For every important feature, document:

```text
Feature name
Status: required | MVP | optional | later | rejected
What it does: one concrete paragraph
Why build it: decision rationale tied to user/problem/business value
Demo proof: what must be visible in the prototype
Notes: risks, dependencies, edge cases, if useful
```

## Prototype/design-system additions

When the source includes UI ideas, include:

- screen inventory
- primary user tasks per screen
- component list
- empty/error/loading states
- responsive behavior
- visual direction
- color/type/spacing tokens if useful
- interaction notes
- what not to design yet

Keep design-system sketches practical, not ornamental.

## HTML style rules

- Single file with embedded `<style>`.
- Use CSS variables.
- Prefer OKLCH colors when writing new CSS.
- Body line length around 65–75ch for prose.
- Use tables for dense comparisons.
- Use cards/blocks sparingly and consistently.
- No gradient text, no decorative blobs, no thick side accent borders.
- No em dashes in copy. Use commas, colons, semicolons, or parentheses.

## Quality checklist

Before final response, verify:

- [ ] File exists and has valid HTML structure.
- [ ] It preserves important ideas from the discussion.
- [ ] Required vs optional scope is visually clear.
- [ ] Every core feature has a “why build it” explanation.
- [ ] MVP and later scope are separated.
- [ ] Open questions are explicit.
- [ ] The page is readable on mobile.
- [ ] The final answer includes the file path only plus a brief summary.
