import Database from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';

const DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');
const OUTPUT_DIR = process.cwd();

const db = new Database(DB_PATH);

function getSessions(): { id: string; title: string; created: Date; updated: Date; slug: string }[] {
  return db
    .query('SELECT id, title, time_created, time_updated, slug FROM session ORDER BY time_created DESC')
    .all()
    .map((r: any) => ({
      id: r.id,
      title: r.title ?? '(untitled)',
      created: new Date(r.time_created),
      updated: new Date(r.time_updated),
      slug: r.slug,
    }));
}

function getMessages(sessionId: string): { id: string; time: Date; parts: any[] }[] {
  const msgRows = db
    .query('SELECT id, time_created FROM message WHERE session_id = ? ORDER BY time_created ASC, rowid ASC')
    .all(sessionId) as any[];

  return msgRows.map((m) => {
    const partRows = db
      .query('SELECT data FROM part WHERE message_id = ? ORDER BY rowid ASC')
      .all(m.id) as any[];
    return {
      id: m.id,
      time: new Date(m.time_created),
      parts: partRows.map((p) => JSON.parse(p.data)),
    };
  });
}

function formatMessage(msg: { id: string; time: Date; parts: any[] }): string {
  const userTexts = msg.parts.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n');
  const toolCalls = msg.parts.filter((p) => p.type === 'tool');
  const reasoningParts = msg.parts.filter((p) => p.type === 'reasoning');
  const hasOnlyMeta = !userTexts.trim() && reasoningParts.length > 0 && toolCalls.length > 0;

  if (hasOnlyMeta) {
    return '';
  }

  const sections: string[] = [];

  if (userTexts.trim()) {
    sections.push('## User', '', userTexts.trim(), '');
  }

  const assistantText = reasoningParts.map((p) => p.text ?? '').join('\n');
  if (assistantText.trim()) {
    sections.push('## Assistant', '', '*Thinking:* ' + assistantText.trim().split('\n').join('\n> '), '');
  }

  for (const tc of toolCalls) {
    const name = tc.tool ?? tc.name ?? '?';
    const status = tc.state?.status ?? 'unknown';
    const args = tc.args ?? tc.input ?? {};
    sections.push(`### Tool: \`${name}\` (${status})`);
    if (Object.keys(args).length > 0) {
      sections.push('', '```json\n' + JSON.stringify(args, null, 2).slice(0, 1000) + '\n```', '');
    }
    if (status === 'completed' && tc.state?.result) {
      const resultStr = typeof tc.state.result === 'string'
        ? tc.state.result.slice(0, 500)
        : JSON.stringify(tc.state.result).slice(0, 500);
      sections.push('**Result:**\n```\n' + resultStr + '\n```', '');
    }
  }

  const toolResults = toolCalls
    .filter((t) => t.state?.status === 'completed' && t.state?.result)
    .map((t) => '  - `' + (t.tool ?? t.name ?? '?') + '` ✓');
  if (userTexts.trim() && toolResults.length === 0 && !assistantText.trim()) {
    return '## User\n\n' + userTexts.trim() + '\n';
  }

  return sections.join('\n');
}

function renderMessages(messages: { id: string; time: Date; parts: any[] }[]): string[] {
  const blocks: string[] = [];

  for (const msg of messages) {
    const text = formatMessage(msg);
    if (text) blocks.push(text, '---', '');
  }

  return blocks;
}

function main() {
  const sessions = getSessions();
  const arg = process.argv[2];

  let target: (typeof sessions)[0] | null = null;

  if (arg) {
    target = sessions.find((s) => s.slug === arg || s.id === arg) ?? null;
  }

  if (!target) {
    console.log('Available recent sessions:');
    for (const s of sessions.slice(0, 10)) {
      console.log(`  ${s.slug.padEnd(25)} ${s.title.slice(0, 60)}`);
    }
    console.log('');
    console.log('Usage: bun scripts/export-conversation.ts <session-slug>');
    process.exit(1);
  }

  const messages = getMessages(target.id);
  const startTime = target.created.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  const endTime = target.updated.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  const filename = `conversation_${startTime}_to_${endTime}.md`;
  const filepath = join(OUTPUT_DIR, filename);

  const lines: string[] = [
    `# Conversation: ${target.title}`,
    '',
    `- **Session:** ${target.id}`,
    `- **Slug:** ${target.slug}`,
    `- **Started:** ${target.created.toISOString()}`,
    `- **Ended:** ${target.updated.toISOString()}`,
    `- **Messages:** ${messages.length}`,
    '',
    '---',
    '',
    ...renderMessages(messages),
  ];

  const content = lines.join('\n');
  Bun.write(filepath, content);
  console.log(`Exported ${messages.length} messages to ${filename}`);
}

main();
