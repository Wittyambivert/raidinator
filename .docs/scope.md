# Raidinator — Product Scope

## Elevator Pitch

Raidinator is an undetectable Telegram user-account bot that silently observes group chats and reacts/replies only when triggered by keywords, target users, or both. It uses the MTProto protocol (identical to the official Telegram app) rather than browser automation or the Bot API, making it indistinguishable from a real human user with the app open. Designed to run 24/7 via PM2.

## Core Behavior

- **99% silent observer** — reads every message but takes no action
- **Triggered only** by keyword match, target-user match, or both (configurable)
- **Human-like activation** — weighted random delay before acting, random skip of matches, varied action patterns
- **Per-group config** — different keywords, skip rates, and rate limits per group via `TARGET_GROUPS_JSON`

### Trigger types

| Trigger | Config field | Behaviour |
|---------|-------------|-----------|
| Keyword match | `KEYWORDS` | Case-insensitive substring match on message text. Compound keywords ("good morning") matched against full text. |
| Target user | `TARGET_USERS` | Matches `sender.username`. If empty, all users match. |

Both filters are ANDed — a message must match at least one keyword AND be from a target user (if users are configured).

## Anti-Detection Layers (6)

| # | Layer | Technique |
|---|-------|-----------|
| 1 | **Protocol** | MTProto — same wire protocol as the official Telegram app. No WebDriver, no browser DOM, no `navigator.webdriver` flag. |
| 2 | **Device spoofing** | GramJS presents as a Samsung Galaxy S21 Ultra (`SM-G998B`) running Android 14 with Telegram app version `10.14.0`. Identical to a real phone. |
| 3 | **Weighted random delays** | Triangular distribution — 60% of delays in 3-8s, 25% in 8-12s, 10% in 1-3s, 5% in 12-15s. Mirrors real human distraction patterns. |
| 4 | **Selective skip** | ~35% of matches are deliberately ignored (`SKIP_PROBABILITY`). Never reacts to 100% of anything — breaks pattern predictability. |
| 5 | **Volume rate cap** | Sliding window rate limiter per action type and per group. Default max 60 actions/hour. Queries `action_log` for windowed counts. |
| 6 | **Schedule scaling** | Activity multiplier per time block. 2am-9am = 0.05x (basically dead). 12pm-1pm = 0.3x (lunch lull). 6pm-11pm = 1.4x (prime time). Controls skip probability, rate limit, and delay ranges. |

## Human Schedule Engine

Configured via `SCHEDULE` env var — comma-separated `HH:MM-HH:MM=multiplier` blocks. Timezone via `SCHEDULE_TIMEZONE`.

The multiplier scales three things simultaneously:
- **Skip probability** — divided by multiplier (lower multiplier = more skipping)
- **Rate limit** — multiplied by multiplier
- **Delay ranges** — stretched inversely to multiplier

```
09:00-12:00=1     → normal activity
12:00-13:00=0.3   → lunch lull (30% activity)
13:00-18:00=1     → normal
18:00-23:00=1.4   → prime time (140% activity)
23:00-02:00=0.5   → tapering off
02:00-09:00=0.05  → asleep (5% activity, effectively silent)
```

At multiplier 0.05, the bot makes ~3 actions/hour max with 95%+ skip rate and 40-300s delays.

## Actions

The bot can perform up to three action types per trigger (randomly selected, sometimes multiple):

| Action | Implementation | Frequency |
|--------|---------------|-----------|
| **React** | `Api.messages.SendReaction` via GramJS | Always. 10% chance of double react (two emojis). Emoji picked randomly from `REACT_EMOJIS` pool. |
| **Reply** | `client.sendMessage({ replyTo: msgId })` | 60% chance for text messages, 30% for media. Shows typing indicator (`TYPING_INDICATOR_MS`) before sending. |
| **Click button** | `message.click({ data: button.data })` | 20% chance if inline buttons present on message. |

Reactions always happen first, then reply, then click — ordered to feel natural.

### Reply sources

Replies come from two sources with fallback chain:

1. **LLM** (if `LLM_API_KEY` is set) — uses OpenAI-compatible API (`LLM_BASE_URL` + `LLM_MODEL`). Provider shortcut available via `LLM_PROVIDER`. Only used ~50% of the time (`LLM_PROBABILITY`). Timeout at `LLM_TIMEOUT_MS` (default 5s).
2. **Markdown templates** (`replies.md`) — one template per line starting with `- `. Supports `{sender}`, `{senderName}`, `{senderFull}`, `{group}`, `{time}`, `{emoji}` placeholders. Always used if LLM unavailable or times out.
3. **Hardcoded fallback** — 5 minimal replies if `replies.md` is missing or empty.

LLM context injection includes group name, sender name/username, and the original message text for situational awareness. LLM inputs and outputs are run through guardrails (instruction-override detection, hallucination markers, PII filter); guardrail failures fall back to markdown templates.

## Dispatch Pipeline (18 Steps)

```
New message → 1. In target group? → 2. Not own message? → 3. Not already seen?
→ 4. Extract text (or caption/media) → 5. Keyword match? → 6. Target user match?
→ 7. Existing reactions ≤ MAX_EXISTING_REACTIONS? → 8. Apply schedule multiplier
→ 9. Random skip roll → 10. Consecutive sender cooldown check → 11. Rate limiter check
→ 12. Emergency stop check → 13. Mark as seen → 14. Human delay
→ 15. React (always) → 16. Reply (sometimes, with typing indicator) → 17. Click button (sometimes)
→ 18. Every API call wrapped in withFloodWait()
```

## Emergency Controls

When `EMERGENCY_STOP_ENABLED=true`, the admin (`ADMIN_USERNAME`) can control the bot via private chat:

| Command | Effect |
|---------|--------|
| `/stop` | Disables all outbound actions. Persisted in DB (`control_state` table). Bot still listens but never acts. |
| `/start` | Re-enables actions. |
| `/status` | Replies with uptime, actions today, rate limit %, schedule multiplier, LLM provider, groups watching. |
| `/schedule` | Dumps current schedule blocks + active multiplier. |
| `/config` | Lists keywords, skip probability, action limits (no secrets). |

## LLM Provider Support

Single `openai` npm package with custom `LLM_BASE_URL`. Every major provider supports OpenAI-compatible chat completions. Zero vendor lock-in.

| Provider | `LLM_BASE_URL` | Default model |
|----------|---------------|---------------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| OpenCode Go | `https://opencode.ai/zen/go/v1` | `kimi-k2.7-code` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Together | `https://api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| Ollama | `http://localhost:11434/v1` | `llama3.2` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` |

Provider shortcut via `LLM_PROVIDER=groq` auto-fills base URL and model. Explicit env vars always override the shortcut.

## Health & Monitoring

- **Heartbeat**: Configurable interval (`HEARTBEAT_INTERVAL_MINUTES`) — logs uptime, actions today, current rate, groups online
- **Crash loop detection**: Tracks restart count. If > `MAX_RESTARTS_PER_HOUR`, sends Telegram alert to admin and exits with non-restart code
- **Group kick detection**: On `ChatForbidden` or `ChannelPrivate` errors, removes group from active watch list with log warning
- **PM2 config**: `max_restarts: 5`, `restart_delay: 60000` (1 min between restarts), `max_memory_restart: 256M`

## Security

- **Session encryption**: Optional AES-256-CBC encryption of session files (`SESSION_ENCRYPTION_KEY`). Derived via PBKDF2 (100k iterations). Encrypted sessions stored in separate directory.
- **Dry-run mode**: `DRY_RUN=true` logs actions without executing. Full pipeline runs — matching, scheduling, rate limiting — but no API calls.
- **Session file warning**: Without encryption, `sessions/*.session` grants full account access. Documented as a risk.

## Out of Scope (v1)

| Item | Reason |
|------|--------|
| Message edit handling | GramJS `EditMessage` event support — trivial to add, skipped for v1. |
| Config hot-reload | Requires file watcher (`chokidar`) + `SIGHUP` handler. Restart via PM2 works fine for v1. |
| Auto-delete replies | `scheduleDate` / self-destruct timers — low priority. |
| LLM cost tracking / dashboard | Log token usage to action_log but no dashboard. |
| Per-group LLM config | All groups share one LLM config. Over-engineering for v1. |
| Web dashboard | Out of scope entirely — CLI + PM2 only. |
