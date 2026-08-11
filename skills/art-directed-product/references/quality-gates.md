# Quality Gates

Mark every applicable item `PASS` or justified `N/A`. A failing gate sends the work back for revision.

## Contract traceability

- The product, surface, audience, primary job, and success criteria match `ART-DIRECTED-PRODUCT.md`.
- The signature is identifiable and carries the art-direction thesis.
- Techniques are traceable to a product need rather than a quota.
- Assumptions remain labeled; product claims have evidence.

## Content and structure

- Realistic content and data fit without hiding required actions.
- Loading, empty, error, success, permission, and edge states relevant to the surface are handled.
- Reading and interaction order match visual hierarchy.
- Structural labels and numbers encode real meaning.
- Action labels state the resulting action consistently.

## Responsive layout

- Inspect at the narrowest supported mobile width, a representative tablet width, and desktop.
- Text remains readable under long content and text zoom.
- Navigation and primary actions remain available without accidental clipping.
- The page has no unintended horizontal overflow.
- Grids have intentional occupancy at each breakpoint; a bento field using variable spans has no accidental empty cells.
- Media dimensions prevent disruptive layout shift.

## Interaction

- Every interactive element has perceivable default, hover where applicable, focus, active, and disabled states.
- Keyboard order follows task order; controls have accessible names.
- Touch targets and gestures have stable, discoverable alternatives.
- Carousels, accordions, pinned content, and custom interactions remain operable without pointer hover.

## Color and typography

- Text and controls meet the contract's contrast baseline in every state and overlay.
- Buttons retain legible foreground/background contrast.
- Type roles, measures, wrapping, fallbacks, and responsive scale match the contract.
- Display composition survives the target content rather than relying on one convenient string.

## Motion

- Motion explains state, hierarchy, causality, or the chosen atmosphere.
- `prefers-reduced-motion` receives a complete, immediately understandable experience.
- Content remains available when JavaScript or scroll-linked animation is absent.
- Scroll triggers are scoped, cleaned up, resize-safe, and tested in both directions.
- Animation avoids persistent jank and does not block input.

## Performance and semantics

- Use semantic elements before custom interaction roles.
- Images have correct alternatives, dimensions, and loading priority.
- Fonts and above-the-fold media are loaded deliberately.
- Decorative layers do not create excessive paint, memory, or network cost.
- Console output contains no new runtime errors or hydration warnings.

## Visual critique

Use browser screenshots when the project runs:

1. Compare mobile and desktop hierarchy.
2. Identify the element most likely to appear in an unrelated template.
3. Revise that element from the product's subject matter.
4. Remove one effect that competes with the signature.
5. Confirm the signature remains memorable without weakening comprehension.

For a prototype, assess all variants against the same question and contract. For production work, run the repository's relevant tests and checks after visual revision.
