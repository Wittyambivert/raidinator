import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  API_ID: z.coerce.number().int().positive('API_ID must be a positive integer'),
  API_HASH: z.string().min(1, 'API_HASH is required'),
  PHONE: z.string().regex(/^\+\d{7,15}$/, 'PHONE must start with + followed by 7-15 digits'),

  TARGET_GROUPS: z.string().optional().default(''),
  TARGET_GROUPS_JSON: z.string().optional().default(''),

  KEYWORDS: z.string().optional().default(''),
  TARGET_USERS: z.string().optional().default(''),

  MAX_ACTIONS_PER_HOUR: z.coerce.number().int().min(1).max(200).default(60),
  SKIP_PROBABILITY: z.coerce.number().min(0).max(1).default(0.35),
  MIN_DELAY: z.coerce.number().int().min(1).default(2),
  MAX_DELAY: z.coerce.number().int().min(1).default(15),
  TYPING_INDICATOR_MS: z.coerce.number().int().min(0).max(10000).default(1500),
  COOLDOWN_BETWEEN_ACTIONS_S: z.coerce.number().int().min(0).default(20),
  MAX_EXISTING_REACTIONS: z.coerce.number().int().min(0).default(5),
  REACT_TO_MEDIA: z.coerce.boolean().default(true),

  LLM_PROVIDER: z.string().optional().default(''),
  LLM_API_KEY: z.string().optional().default(''),
  LLM_BASE_URL: z.string().optional().default(''),
  LLM_MODEL: z.string().optional().default(''),
  LLM_PROBABILITY: z.coerce.number().min(0).max(1).default(0.5),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(5000),
  MAX_REPLY_TOKENS: z.coerce.number().int().min(5).max(200).default(30),
  LLM_SYSTEM_PROMPT: z.string().optional().default(
    'You are {senderName} in a Telegram group called {group}. Reply to {sender}\'s message with a short, casual response. 1-8 words. No emoji unless the message uses them. Maximum one emoji. Sound like a real person, not a bot. Reply ONLY with the text.',
  ),

  REACT_EMOJIS: z.string().default('💯,👍,❤️,👏,😂'),
  REACT_DOUBLE_PROBABILITY: z.coerce.number().min(0).max(1).default(0.1),

  EMERGENCY_STOP_ENABLED: z.coerce.boolean().default(true),
  ADMIN_USERNAME: z.string().optional().default(''),

  SESSION_ENCRYPTION_KEY: z.string().optional().default(''),

  DRY_RUN: z.coerce.boolean().default(false),

  HEARTBEAT_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(30),
  MAX_RESTARTS_PER_HOUR: z.coerce.number().int().min(1).default(5),
  LOG_LEVEL: z.string().default('info'),
  LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  DB_PATH: z.string().default('raidinator.db'),
  SESSIONS_DIR: z.string().default('./sessions'),
  SESSION_ENCRYPTED_DIR: z.string().default('./session.encrypted'),
});

type RawConfig = z.infer<typeof envSchema>;

export interface GroupConfig {
  name: string;
  keywords: string[];
  targetUsers: string[];
  skipProbability: number;
  maxActionsPerHour: number;
}

export interface Config {
  API_ID: number;
  API_HASH: string;
  PHONE: string;

  TARGET_GROUPS: string[];
  TARGET_GROUPS_JSON: string;
  groupConfigs: Map<string, GroupConfig>;

  KEYWORDS: string[];
  TARGET_USERS: string[];

  MAX_ACTIONS_PER_HOUR: number;
  SKIP_PROBABILITY: number;
  MIN_DELAY: number;
  MAX_DELAY: number;
  TYPING_INDICATOR_MS: number;
  COOLDOWN_BETWEEN_ACTIONS_S: number;
  MAX_EXISTING_REACTIONS: number;
  REACT_TO_MEDIA: boolean;

  LLM_PROVIDER: string;
  LLM_API_KEY: string;
  LLM_BASE_URL: string;
  LLM_MODEL: string;
  LLM_PROBABILITY: number;
  LLM_TIMEOUT_MS: number;
  MAX_REPLY_TOKENS: number;
  LLM_SYSTEM_PROMPT: string;

  REACT_EMOJIS: string[];
  REACT_DOUBLE_PROBABILITY: number;

  EMERGENCY_STOP_ENABLED: boolean;
  ADMIN_USERNAME: string;

  SESSION_ENCRYPTION_KEY: string;

  DRY_RUN: boolean;

  HEARTBEAT_INTERVAL_MINUTES: number;
  MAX_RESTARTS_PER_HOUR: number;
  LOG_LEVEL: string;
  LOG_RETENTION_DAYS: number;
  DB_PATH: string;
  SESSIONS_DIR: string;
  SESSION_ENCRYPTED_DIR: string;
}

const LLM_PROVIDER_DEFAULTS: Record<string, { baseURL: string; model: string }> = {
  openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  groq: { baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  deepseek: { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  together: { baseURL: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  ollama: { baseURL: 'http://localhost:11434/v1', model: 'llama3.2' },
  openrouter: { baseURL: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
};

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

interface GroupOverride {
  keywords?: string;
  target_users?: string;
  skip_probability?: number;
  max_actions_per_hour?: number;
}

function parseGroupConfigs(raw: RawConfig): Map<string, GroupConfig> {
  const configs = new Map<string, GroupConfig>();

  if (!raw.TARGET_GROUPS_JSON) return configs;

  let parsed: Record<string, GroupOverride>;
  try {
    parsed = JSON.parse(raw.TARGET_GROUPS_JSON) as Record<string, GroupOverride>;
  } catch {
    return configs;
  }

  for (const [name, override] of Object.entries(parsed)) {
    configs.set(name, {
      name,
      keywords: override.keywords ? parseCsv(override.keywords) : parseCsv(raw.KEYWORDS),
      targetUsers: override.target_users ? parseCsv(override.target_users) : parseCsv(raw.TARGET_USERS),
      skipProbability: override.skip_probability ?? raw.SKIP_PROBABILITY,
      maxActionsPerHour: override.max_actions_per_hour ?? raw.MAX_ACTIONS_PER_HOUR,
    });
  }

  return configs;
}

function resolveLLM(raw: RawConfig): { baseURL: string; model: string } {
  const provider = raw.LLM_PROVIDER?.toLowerCase().trim();

  if (provider && provider !== 'custom' && LLM_PROVIDER_DEFAULTS[provider]) {
    const defaults = LLM_PROVIDER_DEFAULTS[provider]!;
    return {
      baseURL: raw.LLM_BASE_URL || defaults.baseURL,
      model: raw.LLM_MODEL || defaults.model,
    };
  }

  return {
    baseURL: raw.LLM_BASE_URL,
    model: raw.LLM_MODEL,
  };
}

function validateDelays(raw: RawConfig): void {
  if (raw.MIN_DELAY >= raw.MAX_DELAY) {
    throw new Error('MIN_DELAY must be less than MAX_DELAY');
  }
}

function loadRawConfig(): RawConfig {
  const raw = envSchema.safeParse(process.env);
  if (!raw.success) {
    const issues = raw.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return raw.data;
}

export function loadConfig(): Config {
  const raw = loadRawConfig();
  validateDelays(raw);

  const llm = resolveLLM(raw);

  return {
    API_ID: raw.API_ID,
    API_HASH: raw.API_HASH,
    PHONE: raw.PHONE,

    TARGET_GROUPS: parseCsv(raw.TARGET_GROUPS),
    TARGET_GROUPS_JSON: raw.TARGET_GROUPS_JSON,
    groupConfigs: parseGroupConfigs(raw),

    KEYWORDS: parseCsv(raw.KEYWORDS),
    TARGET_USERS: parseCsv(raw.TARGET_USERS),

    MAX_ACTIONS_PER_HOUR: raw.MAX_ACTIONS_PER_HOUR,
    SKIP_PROBABILITY: raw.SKIP_PROBABILITY,
    MIN_DELAY: raw.MIN_DELAY,
    MAX_DELAY: raw.MAX_DELAY,
    TYPING_INDICATOR_MS: raw.TYPING_INDICATOR_MS,
    COOLDOWN_BETWEEN_ACTIONS_S: raw.COOLDOWN_BETWEEN_ACTIONS_S,
    MAX_EXISTING_REACTIONS: raw.MAX_EXISTING_REACTIONS,
    REACT_TO_MEDIA: raw.REACT_TO_MEDIA,

    LLM_PROVIDER: raw.LLM_PROVIDER,
    LLM_API_KEY: raw.LLM_API_KEY,
    LLM_BASE_URL: llm.baseURL,
    LLM_MODEL: llm.model,
    LLM_PROBABILITY: raw.LLM_PROBABILITY,
    LLM_TIMEOUT_MS: raw.LLM_TIMEOUT_MS,
    MAX_REPLY_TOKENS: raw.MAX_REPLY_TOKENS,
    LLM_SYSTEM_PROMPT: raw.LLM_SYSTEM_PROMPT,

    REACT_EMOJIS: parseCsv(raw.REACT_EMOJIS),
    REACT_DOUBLE_PROBABILITY: raw.REACT_DOUBLE_PROBABILITY,

    EMERGENCY_STOP_ENABLED: raw.EMERGENCY_STOP_ENABLED,
    ADMIN_USERNAME: raw.ADMIN_USERNAME,

    SESSION_ENCRYPTION_KEY: raw.SESSION_ENCRYPTION_KEY,

    DRY_RUN: raw.DRY_RUN,

    HEARTBEAT_INTERVAL_MINUTES: raw.HEARTBEAT_INTERVAL_MINUTES,
    MAX_RESTARTS_PER_HOUR: raw.MAX_RESTARTS_PER_HOUR,
    LOG_LEVEL: raw.LOG_LEVEL,
    LOG_RETENTION_DAYS: raw.LOG_RETENTION_DAYS,
    DB_PATH: raw.DB_PATH,
    SESSIONS_DIR: raw.SESSIONS_DIR,
    SESSION_ENCRYPTED_DIR: raw.SESSION_ENCRYPTED_DIR,
  };
}

export const config = loadConfig();
