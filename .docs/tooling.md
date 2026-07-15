# Raidinator — Tooling Reference

## Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Runtime | Node.js 20+ | JavaScript runtime |
| Package manager | **bun** | Install, run scripts, typecheck |
| Language | TypeScript 5 (strict) | All source code |
| MTProto Client | `telegram` (GramJS) | Telegram protocol client — user account automation |
| Database | `better-sqlite3` | Synchronous embedded SQLite — no server process |
| Logging | `pino` + `pino-pretty` | Structured JSON logs (dev: human-readable) |
| Config | `zod` + `dotenv` | Runtime validation of `.env` + type inference |
| LLM | `openai` | OpenAI-compatible API client (works with any provider) |
| Timezones | `luxon` | Human schedule engine timezone calculations |
| OTP input | `input` | Terminal password prompt for first-time login |
| Dev runner | `tsx` | Run TypeScript without build step |
| Build | `tsc` | Compile TypeScript → `dist/` |
| Process manager | `pm2` (global) | 24/7 uptime, auto-restart, crash loop protection |

## Project File Structure

```
raidinator/
├── .env                            # secrets + config (gitignored)
├── .env.example                    # template — all fields documented with provider refs
├── .gitignore
├── AGENTS.md                        # orchestrator (loaded automatically by OpenCode)
├── replies.md                       # static reply templates with {placeholders}
├── package.json
├── tsconfig.json                    # strict mode, target ES2022, module NodeNext
├── ecosystem.config.js              # PM2 config
├── .docs/                           # agent definitions and context files
│   ├── scope.md                     # product scope
│   ├── tooling.md                   # this file
│   ├── pm-agent.md
│   ├── architect-agent.md
│   ├── engineer-agent.md
│   ├── code-review-agent.md
│   └── qa-agent.md
├── scripts/
│   └── export-conversation.ts       # exports OpenCode session to markdown
├── sessions/                        # plaintext GramJS session strings (gitignored)
├── session.encrypted/               # AES-256 encrypted sessions (gitignored)
├── logs/                            # PM2 + pino file logs (gitignored)
├── backups/                         # DB backups (gitignored)
└── src/
    ├── index.ts                     # entry — client init, event loop, graceful shutdown, heartbeat
    ├── config.ts                    # zod schema, env loader, provider defaults, per-group resolution
    ├── client.ts                    # createClient, session load/save/encrypt, device spoofing
    ├── db.ts                        # schema migrations, CRUD for all tables
    ├── handlers/
    │   ├── message.ts              # full 18-step dispatch pipeline
    │   ├── commands.ts             # /stop, /start, /status, /schedule, /config
    │   └── actions.ts              # react(), reply(), clickInlineButton()
    ├── services/
    │   ├── llm.ts                   # OpenAI client, provider shortcut resolver, prompt builder
    │   └── replies.ts              # load/parse replies.md, placeholder resolution
    └── utils/
        ├── anti-detect.ts          # humanDelay (triangular), shouldSkip, pickRandom, gaussianJitter
        ├── rate-limiter.ts         # RateLimiter per-group, sliding window, non-blocking
        ├── schedule.ts             # ScheduleEngine, parse SCHEDULE, getMultiplier()
        ├── flood-wait.ts           # withFloodWait() wrapper for all API calls
        ├── health.ts               # heartbeat, crash loop detection, group-access check
        ├── encrypt.ts              # AES-256-CBC session encrypt/decrypt with PBKDF2
        └── logger.ts               # pino instance, file rotation, level from config
```

## Database Schema

All tables in a single SQLite file (`raidinator.db`). WAL mode enabled.

```sql
CREATE TABLE IF NOT EXISTS seen_messages (
    message_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    processed_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (message_id, chat_id)
);

CREATE TABLE IF NOT EXISTS action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    action_type TEXT NOT NULL,       -- 'react' | 'reply' | 'click'
    action_detail TEXT,               -- emoji used | reply text | button text
    source TEXT,                      -- 'llm' | 'markdown' | 'fallback' (replies only)
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS control_state (
    key TEXT PRIMARY KEY,             -- e.g. 'stopped', 'last_restart', 'crash_count'
    value TEXT NOT NULL
);
```

**Indexes:**
```sql
CREATE INDEX IF NOT EXISTS idx_action_log_timestamp ON action_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_action_log_type_time ON action_log(action_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_seen_processed ON seen_messages(processed_at);
```

## Key Commands

| Command | Purpose |
|---------|---------|
| `bun install` | Install all dependencies |
| `bun run dev` | Start with tsx (hot reload) |
| `bun run dev:dry` | Start in dry-run mode (no actions executed) |
| `bun run build` | Compile TypeScript → `dist/` |
| `bun run start` | Run compiled `dist/index.js` |
| `bun run typecheck` | Validate TypeScript without emitting |
| `bun run pm2:start` | Start 24/7 via PM2 |
| `bun run pm2:stop` | Stop the bot |
| `bun run pm2:restart` | Restart the bot |
| `bun run pm2:logs` | Tail PM2 logs |
| `bun run pm2:status` | Check if running |
| `bun scripts/export-conversation.ts <slug>` | Export OpenCode session to markdown |

## LLM Provider Shortcuts

Configured in `src/config.ts`. If `LLM_PROVIDER` is set, `LLM_BASE_URL` and `LLM_MODEL` auto-fill. Explicit env vars override.

```typescript
const LLM_PROVIDER_DEFAULTS: Record<string, { baseURL: string; model: string }> = {
  openai:       { baseURL: 'https://api.openai.com/v1',          model: 'gpt-4o-mini' },
  'opencode-go':{ baseURL: 'https://opencode.ai/zen/go/v1',      model: 'kimi-k2.7-code' },
  groq:         { baseURL: 'https://groq.com/openai/v1',         model: 'llama-3.3-70b-versatile' },
  deepseek:     { baseURL: 'https://api.deepseek.com/v1',        model: 'deepseek-chat' },
  together:     { baseURL: 'https://api.together.xyz/v1',        model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  ollama:       { baseURL: 'http://localhost:11434/v1',          model: 'llama3.2' },
  openrouter:   { baseURL: 'https://openrouter.ai/api/v1',      model: 'openai/gpt-4o-mini' },
  custom:       { baseURL: '',                                   model: '' },
};
```

## PM2 Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'raidinator',
    script: 'dist/index.js',
    watch: false,
    max_restarts: 5,             // crash loop protection
    restart_delay: 60000,        // wait 1 min between restarts
    max_memory_restart: '256M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    merge_logs: true,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
```

## Conventions

### File Naming

- **kebab-case** for non-component modules: `rate-limiter.ts`, `anti-detect.ts`, `message-handler.ts`
- **PascalCase** for classes and interfaces when they are the primary export: `RateLimiter`, `GroupConfig`
- Service files describe what they provide: `llm.ts`, `replies.ts`, `client.ts`

### Imports

```typescript
import type { Config, GroupConfig } from '../config.js';   // type-only imports
import { TelegramClient } from 'telegram';                   // value imports
import { StringSession } from 'telegram/sessions';           // named from package
```

### Logging

```typescript
import { logger } from '../utils/logger.js';

logger.info({ action: 'react', messageId, emoji }, 'Reacted to message');
logger.warn({ seconds: e.seconds }, 'FloodWait — sleeping');
logger.error({ err, chatId }, 'Failed to send reply');
// NEVER log: API keys, session strings, phone numbers
```

### Error Handling

- No empty catch blocks. Every caught error must be: logged + recovered OR logged + re-thrown.
- GramJS API calls wrapped in `withFloodWait()` from `src/utils/flood-wait.ts`.
- Config validation fails fast — `zod` parse at startup, no default fallbacks for missing required fields.

### Database

- Synchronous `better-sqlite3` — `db.prepare().run()`, `db.prepare().all()`, `db.prepare().get()`.
- WAL mode enabled for concurrent reads.
- Transactions for multi-statement operations.
- Parameterized queries always — never string concatenation for SQL.

### GramJS Patterns

```typescript
// Session management
const session = new StringSession(loadedSessionString || '');
const client = new TelegramClient(session, apiId, apiHash, {
  deviceModel: 'SM-G998B',
  systemVersion: 'Android 14',
  appVersion: '10.14.0',
});

// API calls — always wrapped
import { withFloodWait } from '../utils/flood-wait.js';
await withFloodWait(() => client.invoke(
  new Api.messages.SendReaction({ peer, msgId, reaction: [...] })
), logger);

// Event handling
client.addEventHandler(handler, new NewMessage({}));
```

### Anti-Detect Utilities

- `humanDelay(min, max)` — triangular distribution delay (skewed toward middle)
- `shouldSkip(probability)` — random skip check
- `pickRandom(array)` — uniform pick
- `gaussianJitter(mean, stddev)` — human-like timing variance

## Verification

Before marking any code change as complete, agents MUST run:

```bash
bun run typecheck
```

If the command is not yet configured in `package.json`, the agent must first create a valid `package.json` and `tsconfig.json` that enables it, then run it.
