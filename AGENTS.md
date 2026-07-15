# Raidinator — AI Agent Orchestrator

## Golden Rule

**ALWAYS use `bun` as the package manager. NEVER use `npm`, `yarn`, or `pnpm`.**

| Action | Command |
|--------|---------|
| Install deps | `bun install` |
| Add package | `bun add <package>` |
| Add dev package | `bun add -d <package>` |
| Run script | `bun run <script>` |
| Run TypeScript directly | `bun run tsx src/index.ts` |

## Project Context Files

All agents MUST load these context files before starting work:

| File | Content |
|------|---------|
| `.docs/scope.md` | Product scope — what Raidinator is, anti-detection layers, dispatch pipeline, LLM integration, deployment |
| `.docs/tooling.md` | Stack reference — GramJS, better-sqlite3, pino, zod; file structure, DB schema, commands, LLM providers |
| `AGENTS.md` | This orchestrator — pipeline, conventions, invocation rules |

Additional project files agents should be aware of:

| File | Content |
|------|---------|
| `scripts/export-conversation.ts` | Exports OpenCode conversation history to markdown — used for documentation and traceability |
| `replies.md` | Static reply templates with `{placeholder}` variable substitution |
| `.env.example` | All configuration fields with defaults and provider reference table |

## What Raidinator Is

An undetectable Telegram user-account bot that silently observes group chats and reacts/replies only when triggered by keywords or target users. Built on GramJS (MTProto protocol — same protocol the official Telegram app uses). Designed to run 24/7 via PM2 with six anti-detection layers: MTProto protocol spoofing, device model spoofing (Samsung Galaxy S21), weighted triangular random delays, selective skip (~35%), sliding-window rate cap, and timezone-aware activity schedule scaling.

## Technology Stack

- **Runtime**: Node.js 20+ / Bun (package manager + scripts)
- **Language**: TypeScript 5 (strict mode, no `any`)
- **MTProto Client**: GramJS (`telegram` package)
- **Database**: better-sqlite3 (synchronous, embedded — no server process)
- **Logging**: pino (structured JSON logs, pino-pretty for dev)
- **Config Validation**: zod (runtime type-checking of `.env`)
- **LLM**: openai npm package (OpenAI-compatible API — supports OpenAI, Groq, DeepSeek, Ollama, OpenRouter, Together, and any custom endpoint)
- **Process Manager**: PM2 (global, 24/7 uptime, auto-restart, crash loop protection)
- **Timezones**: luxon (for human schedule engine)

## Agent Pipeline

```
FEATURE REQUEST / BUG REPORT
        │
        ▼
┌─────────────────┐
│  PM Agent         │  Reads scope.md + tooling.md
│  (.docs/pm-agent) │  Output: epics, stories, acceptance criteria
└────────┬────────┘
         │ stories + AC
         ▼
┌───────────────────┐
│  Architect Agent   │  Reads PM output + codebase + scope + tooling
│  (.docs/architect) │  Output: DDD model, service interfaces, DTOs, file map, DB migrations
└────────┬──────────┘
         │ architecture spec
         ▼
┌────────────────────┐
│  Engineer Agent     │  Reads Architect output + tooling.md + scope.md
│  (.docs/engineer)   │  Output: working .ts files following project conventions
└────────┬───────────┘
         │ implemented code
         ▼
┌────────────────────────┐
│  Code Review Agent       │  Confidence-scored review across 8 security audit categories
│  (.docs/code-review)     │  + OWASP-aligned bug bounty checks
│                          │  Output: approval ✅ or change requests ❌ with file:line + confidence
└──┬──────────┬───────────┘
   │ approved │ changes requested
   ▼          ▼
┌────────────┐  (back to Engineer Agent with review feedback)
│ QA Agent    │◄────────────────┐
│ (.docs/qa)  │                 │
└──┬─────┬────┘                 │
   │     │                      │
   │     ▼                      │
   │  Edge cases cover:         │
   │  • Boundary values         │
   │  • Concurrency/race cond.  │
   │  • Network failures        │
   │  • State transitions       │
   │  • FloodWait handling      │
   │  • Schedule edge times     │
   │                             │
   ▼                             │
 PASS ✅ or FAIL ❌              │
 (loop back to Engineer) ───────┘
```

## Agent Invocation Rules

### 1. PM Agent
**Trigger**: New feature, behavior change, or configuration expansion is requested.
**Input**: scope.md + tooling.md + user's feature description.
**Output**: Markdown spec with epic, user stories (format: "As a ___, I want ___ so that ___"), acceptance criteria (Given/When/Then), priority (P0-P4), success metrics (SMART).
**Constraint**: Must NOT propose implementation — only describe WHAT, not HOW.

### 2. Architect Agent
**Trigger**: PM Agent output is ready.
**Input**: PM spec + tooling.md + scope.md + existing codebase (read current files).
**Output**: Architecture Decision Document containing:
  - Domain model (entities: what the bot manages — Message, GroupConfig, RateLimit, Session)
  - Service layer interfaces (ClientService, MessageHandler, ActionDispatcher, LLMService, ReplyService)
  - DTO contracts (TypeScript interfaces for every data transfer object)
  - File map (every .ts file to create or modify with purpose)
  - Database migration plan (DDL changes for seen_messages, action_log, control_state)
  - GramJS integration points (which MTProto API calls, where flood-wait wrapping goes)
**Constraint**: Must reference exact GramJS APIs (no guessing). Must check `node_modules/telegram/` for actual method signatures.

### 3. Engineer Agent
**Trigger**: Architect Agent output is ready.
**Input**: Architecture spec + tooling.md + scope.md.
**Output**: Working .ts files following:
  - All TypeScript strict conventions (no `any`, proper generics, `import type`)
  - kebab-case file names, PascalCase for type-only constructs
  - GramJS patterns: `withFloodWait()` wrapper, `Api.messages.SendReaction`, `StringSession`
  - better-sqlite3 synchronous patterns
  - pino structured logging (`logger.info({ action, messageId }, 'Reacted')`)
  - zod for config parsing at boundaries
  - All error paths handled — no silent failures
  - Rate limiter, schedule engine, anti-detect utilities as discrete modules
**Constraint**: Must NOT modify files outside the feature scope. Must run `bun run typecheck` after changes. Must not add dependencies without approval. Only change what was asked — simplest solution first.

### 4. Code Review Agent (with Bug Bounty)
**Trigger**: Engineer Agent delivers code.
**Input**: All files changed by Engineer + architecture spec + scope.md.
**Output**: Review report with:
  - **Confidence-scored findings** (0-100 scale, only report ≥80 as blockers/warnings)
  - **8 security audit categories** (auth, injection, secrets, race conditions, crypto, data exposure, dependencies, network)
  - **Anti-detection integrity check** — are all 6 layers correctly implemented?
  - **TypeScript strictness** — no `any`, proper generics, no unsafe assertions
  - **GramJS correctness** — correct API calls, flood-wait wrapping on all mutations
  - **Database safety** — no SQL injection, proper transactions, WAL mode
  - **Config security** — no secrets in logs, session files encrypted if key set
  - Severity: 🔴 blocker (≥90), 🟡 warning (80-89), 🟢 suggestion (70-79 optional)
**Constraint**: Each issue must reference specific file:line. Must include reproducible exploit steps for security findings.

### 5. QA Agent (with Edge Cases)
**Trigger**: Code Review Agent approves code.
**Input**: Implemented code + PM acceptance criteria + scope.md.
**Output**: Test report:
  - **Acceptance criteria verification matrix** (each AC mapped to code path or test)
  - **Dry-run execution results** (`DRY_RUN=true bun run dev` — verify pipeline doesn't crash)
  - **Edge case coverage report** across 9 categories:
    1. Boundary values (zero actions, max actions, empty keywords, single target)
    2. Concurrency (simultaneous messages, rate limiter under load)
    3. Network failures (disconnect, reconnect, session expiry)
    4. Data edge cases (malformed messages, non-text content, stickers)
    5. State transitions (bot stopped mid-action, PM2 restart during operation)
    6. Authorization (kicked from group, channel becomes private)
    7. Precision/limits (exact rate limit boundary, action count overflow)
    8. External failures (OpenAI timeout, LLM_BASE_URL unreachable, DB locked)
    9. User behavior (rapid-fire messages, edited messages, deleted messages)
  - **Schedule engine verification** — confirm multiplier scaling at boundary times
  - **Rate limiter stress test** — verify sliding window correctness
  - **FloodWait recovery test** — verify withFloodWait retries correctly
**Constraint**: Failed tests block merge. Must list exact reproduction steps for each failure. Must test with `DRY_RUN=true` first.

## Coding Conventions (ALL Agents Must Follow)

1. **Package manager**: `bun` only. Never type `npm`, `yarn`, or `pnpm` in any command.
2. **TypeScript strict**: No `any`. Use `unknown` + type guards, or proper generics. All files must have `strict: true`.
3. **Type imports**: Use `import type { ... }` for type-only imports.
4. **File names**: kebab-case for files (`rate-limiter.ts`, `anti-detect.ts`), PascalCase for classes/interfaces when they're the primary export.
5. **No magic strings**: All constants in config or dedicated constants files. API URLs, default values, limits — all from `.env` or `config.ts`.
6. **Error handling**: Every error path must be handled — log + recover or log + propagate. No empty catch blocks. No silent failures.
7. **Logging**: Structured logging via `pino` only. No `console.log`. Log format: `logger.info({ context }, 'message')`. Never log secrets.
8. **Comments**: No comments in code unless explaining a non-obvious algorithmic decision (e.g., "triangular distribution delay prevents timing fingerprint").
9. **Semantic commits**: [Conventional Commits](https://www.conventionalcommits.org/) format: `type(scope): description`. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.
10. **No unprompted commits**: NEVER commit, push, or create PRs unless explicitly commanded by the user.
11. **Verification loop**: After making code changes, run `bun run typecheck`. If it fails, fix and re-check before marking the task complete.
12. **GramJS API calls**: Every outbound API call (react, reply, click) MUST be wrapped in `withFloodWait()`. The only exceptions are read-only operations (getMessages, getDialogs).

## Running the Bot

| Command | Purpose |
|---------|---------|
| `bun run dev` | Start with `tsx` (hot reload in dev) |
| `bun run dev:dry` | Start in dry-run mode (logs actions, no execution) |
| `bun run build` | Compile TypeScript → `dist/` |
| `bun run start` | Run compiled `dist/index.js` |
| `bun run typecheck` | Validate TypeScript without emitting |
| `bun run pm2:start` | Start 24/7 via PM2 |
| `bun run pm2:stop` | Stop the bot |
| `bun run pm2:logs` | Tail PM2 logs |
| `bun run pm2:status` | Check if running |
| `bun scripts/export-conversation.ts <slug>` | Export current conversation to markdown |

## How to Use OpenCode with This Project

1. OpenCode loads this `AGENTS.md` automatically on session start.
2. To invoke a subagent explicitly: `@engineer-agent implement the rate limiter`.
3. Subagents are defined in `.docs/*.md` with OpenCode-compatible YAML frontmatter.
4. To export your conversation for documentation: `bun scripts/export-conversation.ts <session-slug>`.
5. Use Tab to switch between Plan mode (read-only analysis) and Build mode (file changes).
