Save this conversation to an MD file. The file should be named with the start and end date/times of this conversation.

Work:

1. Read `~/.local/share/opencode/opencode.db` — it's a SQLite database.
2. Query the `session` table to find the current session (latest by `time_created`). Each session has an `id`, `title`, `slug`, `time_created`, `time_updated`.
3. Query the `message` table for all messages in that session, ordered by `time_created ASC, rowid ASC`.
4. For each message, query the `part` table for all parts, ordered by `rowid ASC`. Each part's `data` column is a JSON string.
5. Part types include `"text"` (user text), `"reasoning"` (assistant thinking), `"tool"` (tool execution, has `tool`, `state.status`, `state.result`), `"step-start"`, `"step-finish"` (skip these).
6. Filter out messages that only contain meta-parts (reasoning + tool calls with no user text). For the rest:
   - User messages: parts with `type === "text"`, join the `.text` fields
   - Tool calls: parts with `type === "tool"`, show the tool name, status, arguments, and result (truncated)
   - Assistant thinking: parts with `type === "reasoning"`, show the `.text`
7. Build a markdown file with:
   - A header with session metadata (title, slug, start/end times, message count)
   - Each message as a `## User` / `## Assistant` / `### Tool: \`name\`` block separated by `---`
   - Timestamps are in milliseconds — `new Date(value)` directly (no division)
8. Clean the timestamps for the filename: `toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')`
9. Save to `conversation_{start}_{end}.md`

If `bun:sqlite` is available (Bun runtime), use it directly. Otherwise, import `better-sqlite3` or use `sqlite3` CLI.

The script already exists at `scripts/export-conversation.ts` in the project — just run `bun scripts/export-conversation.ts <session-slug>` to reuse it. If you need to create it fresh, the above steps are all you need.
