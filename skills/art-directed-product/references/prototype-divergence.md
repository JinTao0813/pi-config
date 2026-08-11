# Prototype Divergence

Apply this only while following the `prototype` skill's **UI branch**. The prototype's route, switcher, handoff, capture, and cleanup rules remain authoritative.

## State the question

Write one falsifiable design question. Good questions compare hierarchy, composition, or interaction for the same product outcome. Keep content, data, and functional scope constant across variants so the comparison isolates design direction.

## Generate provocations

From the skill directory, run:

```bash
python3 scripts/generate-provocations.py \
  --contract <product-root>/ART-DIRECTED-PRODUCT.md \
  --question "<the design question>"
```

The script derives a deterministic seed from the contract and question, then returns three combinations of exploration axes. Record the seed and generated constraints beside the prototype's one-line question.

A provocation is a creative constraint, not a design decision. Translate it through the contract; replace any generated axis that violates an invariant and record the replacement.

## Build orthogonal variants

Default to three variants. Each must differ from the others in at least:

- Information hierarchy
- Composition
- Primary interaction or affordance

Density, motion, and media relationship should reinforce those structural differences. Variants that differ mainly in palette, border radius, imagery, or copy are one design wearing different clothes and must be redrafted.

All variants must preserve:

- The same primary job and required content
- The contract's invariants and accessibility baseline
- Realistic data and edge-state pressure
- The project's component and styling constraints, unless replacing one is the explicit question

## Select through evidence

Random output has no vote. The user selects, combines, or rejects variants by judging the stated question. Record:

- Winning variant, or elements borrowed from each
- What evidence resolved the question
- Tradeoffs accepted
- What remains deferred

Then update `ART-DIRECTED-PRODUCT.md` and follow the prototype skill's branch capture and production rewrite process.

**Complete when:** the variants are structurally distinct, the user has resolved the question, and the resulting decision is recorded in the contract.
