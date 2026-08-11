# Cinematic Arsenal

These are conditional patterns, not a checklist. Select the smallest set that executes the contract's signature and motion character.

## Hero architectures

### Cinematic center

Best for one persuasive thesis with strong media. Use a broad headline measure, controlled line count, high-contrast actions, and a background treatment that protects legibility.

### Artistic asymmetry

Best when subject matter benefits from tension or overlap. Anchor reading order first; keep decorative media outside critical copy and interaction paths.

### Editorial split

Best for paired argument and evidence. Preserve meaningful negative space and let the media carry information rather than acting as a generic half-page fill.

Application and utility surfaces may omit a hero entirely.

## Dense composition

### Bento field

Use for a small set of comparable or complementary ideas. Prefer three to five intentional regions. Define every occupied cell at each breakpoint, use dense placement when spans vary, and verify that changing content cannot create dead corners. A complete grid matters more than ornamental span complexity.

### Pinned split gallery

Pin a stable argument while related evidence advances. Suitable for narrative comparison on large screens. On narrow screens and reduced motion, return to normal document flow.

### Card stack

Use when sequence and accumulation are meaningful. Maintain readable stacking order, keyboard access, and a non-overlapping fallback.

## Typographic components

### Inline media typography

Embed small contextual media within display text when the image completes the phrase. Set explicit dimensions and alignment, supply meaningful alternatives where needed, and preserve line composition across breakpoints.

### Scrubbed text reveal

Use for a short central thesis whose pacing benefits from reading with scroll. Keep base text legible without JavaScript and provide an immediate reduced-motion state.

## Interactive components

### Horizontal accordion

Use when a few peer categories benefit from rapid visual comparison. Expanded content must remain reachable by keyboard and touch; mobile should use a vertical disclosure or another stable form.

### Trusted-source marquee

Use only when the sequence can repeat without implying false endorsement or reading order. Pause on interaction, provide reduced-motion behavior, and keep source names available to assistive technology.

### Testimonial carousel

Use for a concise set of attributable evidence. Controls need names, focus visibility, deterministic ordering, and manual navigation. Auto-advance should never be required to access content.

## Ambient material

Radial light, grain, mesh, composited images, and subtle texture can establish material character. Apply them through a small tokenized system so text contrast and rendering cost remain predictable.

## Motion paradigms

### Scale-and-fade media

Grow media toward its settled state as it enters, then reduce emphasis only when the next item becomes primary. Content should remain understandable at every scroll position.

### Scroll pinning

Reserve pinning for a relationship that benefits from sustained context. Scope triggers, clean them up on unmount, test refresh and resize, and remove pinning on constrained viewports when it harms flow.

### Direct-response physics

Hover, press, drag, and focus feedback should correspond to the user's action. Animate compositor-friendly properties where possible and keep durations proportional to distance and importance.

Use the project's established animation stack. When GSAP is justified, register plugins once, scope selectors, revert contexts on cleanup, and pair ScrollTrigger behavior with reduced-motion and small-screen alternatives.
