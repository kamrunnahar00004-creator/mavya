# Mavya Skill Router

Status: mandatory for Claude and Codex.

## Rule

Before any non-trivial work:

1. Read the task.
2. Read the relevant source docs.
3. Search Ruflo namespace `mavya`.
4. Select the smallest useful skill set.
5. State selected and skipped skills.
6. Work only after routing.

Do not install skills from `https://www.skills.sh/` without founder approval.

## Local Source Docs

Always consider:

- `docs/PROJECT_OUTLINE_DRAFT.md`
- `docs/DAILY_WORK_PLAN.md`
- `docs/AGENT_RESPONSIBILITIES.md`
- `docs/PHOTO_AUDIT_RUBRIC.md`
- `docs/SKILL_ROUTER.md`
- `AGENTS.md`
- `CLAUDE.md`

## Task Routes

| Task type | Skills to route toward |
|---|---|
| Product strategy, positioning, pricing | product strategy, copywriting |
| Video hooks, scripts, TikTok ideas | copywriting, growth, short-form content |
| Landing page copy | copywriting, conversion UX |
| Photo scoring rubric | product strategy, AI prompting, UX clarity |
| Upload/result UI | frontend UI, UX, accessibility |
| Result-card visual polish | frontend UI, visual design |
| Before/after preview UI | frontend UI, visual design |
| Thumbnail crop preview | frontend UI, image processing |
| Lighting/color correction | image processing, frontend or backend API |
| Clean-background cleanup | image processing, AI image tools, security audit if uploaded files hit backend |
| Lifestyle scene generation | AI image tools, product strategy, security audit if file uploads are used |
| OpenAI photo-audit prompt | AI prompting, evals, product strategy |
| API route for photo audit | backend API, security audit |
| File uploads/storage | backend API, security audit |
| Payments | payments, security audit |
| Auth | auth, security audit |
| Database schema | backend architecture, security audit |
| Claude diff review | reviewer, testing, security audit |
| Docs/source-of-truth update | technical writing, memory management |

## Current Phase Defaults

Because Mavya is in validation/demo mode, prefer:

- copywriting for video/demo wording
- frontend UI for the local demo screen
- AI prompting for the audit rubric
- lightweight image processing for thumbnail/crop/light tests
- memory management for durable decisions

Usually skip:

- payments
- auth
- database
- ecommerce integrations
- full lifestyle image generation
- complex backend architecture

Current V0 default:

```text
free score and fixes + thumbnail preview + truthful AI-improved hero preview
```

Use AI image tooling for approved improved-hero preview experiments. Preserve product
identity, inspect fidelity drift, and label generated results honestly. Crop and
lighting tools remain useful internally, but do not create a paid light-polish tier.
The paid hypothesis is full AI polish with an improved-score reveal. Full lifestyle
scene generation is deferred unless the founder explicitly approves it.

## Required Routing Output

Agents should write:

```text
Skill routing:
- Task type:
- Source docs checked:
- Ruflo memory checked:
- Selected skills:
  - [skill/category]: [why]
- Skipped skills:
  - [skill/category]: [why not needed]
- Files likely touched:
- Verification:
```

## Codex-Specific Rule

Codex must also route to available local Codex skills when a task matches them.

Examples:

- `memory-management` for shared decisions and Ruflo sync
- `security-audit` for auth, payments, file uploads, API boundaries, and secrets
- `sparc-methodology` for complex architecture
- `swarm-orchestration` for large multi-file product implementations

Codex should not use a large skill or swarm for tiny edits.
