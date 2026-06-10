# Agent Responsibilities

Status: active coordination rules for Mavya.

## Purpose

This file keeps Claude, Codex, and the founder aligned.

The main risk is not technical failure. The main risk is drifting back into overbuilding before market signal exists.

## Founder Responsibilities

The founder owns:

- product direction approval
- niche selection
- sample photo collection
- video posting
- customer conversations
- pricing acceptance
- final go/no-go decisions

Founder should spend most weekly time on distribution and validation, not product polish.

## Claude Responsibilities

Claude is the first-pass builder and creative executor.

Claude should do:

- local demo UI
- landing page drafts
- upload/result page implementation
- before/after demo UI
- first-pass crop/thumbnail/result surfaces
- visual polish passes
- video script drafts
- copy variants
- quick product experiments

Claude should optimize for speed and useful artifacts.

Claude should not:

- expand scope without asking
- add payments/auth/database by default
- add full lifestyle image generation by default
- change the north star alone
- build platform features during validation
- ignore skill routing
- work without reading the source docs

## Codex Responsibilities

Codex is the reviewer, fixer, verifier, and memory keeper.

Codex should do:

- review Claude's diffs
- simplify overbuilt work
- run builds/tests
- fix bugs
- own backend/API/file-upload correctness when backend work is needed
- own payment/auth/security review when those are introduced
- check secret hygiene
- check API safety
- update docs when direction changes
- sync Ruflo memory
- remind founder when work drifts away from validation

Codex should not:

- overbuild the product
- silently change strategy
- keep polishing when distribution work is more important
- create new paid infrastructure without founder approval
- replace Claude as the default first-pass frontend builder unless the founder asks

## Default Handoff Pattern

1. Founder gives task.
2. Claude reads source docs and skill-routes.
3. Claude builds first pass.
4. Claude writes a handoff.
5. Codex reviews and verifies.
6. Codex fixes bugs and updates docs/Ruflo if needed.
7. Founder tests and decides next action.

## Current Active Product

```text
Mavya
```

Active workspace:

```text
~/mavya
```

Parked repo:

```text
~/ai-ctf-mvp
```

The old repo is reference only unless the founder explicitly says otherwise.

## Current Phase

```text
Validation and demo creation.
```

Current priority:

1. Organize collected sample photos.
2. Pick 5 strongest examples.
3. Create short manual audits.
4. Test AI-improved hero-photo output quality and detail fidelity across five products.
5. Wire one truthful generated preview into the demo result screen.
6. Record and post 5 videos.
7. Test payment by day 10.
8. Review signal.

## Decision Rule

Build more only when it helps one of these:

- create demos faster
- post videos faster
- collect seller feedback
- test willingness to pay
- improve conversion from upload to paid audit

If a feature does not help those, defer it.

## Current V0 Scope

V0 must create a visible demo loop:

```text
weak photo -> score + free fixes -> thumbnail preview -> AI-improved hero preview
```

The founder approved testing a bounded AI-generated hero-photo transformation as the
paid outcome. It must remain product-centered, be labeled as AI-improved, and disclose
that fine product details should be reviewed before publishing. Full lifestyle scene
generation is still not default V0. Do not add a paid light-polish tier; the simpler
direction is full AI polish plus a new score reveal.
