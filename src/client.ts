import { TelegramClient, sessions } from 'telegram';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config } from './config';
import { logger } from './utils/logger';
import { encryptSession, decryptSession } from './utils/encrypt';

const { StringSession } = sessions;

const DEVICE_MODEL = 'SM-G998B';
const SYSTEM_VERSION = 'Android 14';
const APP_VERSION = '10.14.0';

function getSessionPath(): string {
  const phone = config.PHONE.replace(/\D/g, '');
  const dir = config.SESSION_ENCRYPTION_KEY ? config.SESSION_ENCRYPTED_DIR : config.SESSIONS_DIR;
  mkdirSync(dir, { recursive: true });
  return join(dir, `${phone}.session`);
}

function loadSessionString(): string | null {
  const path = getSessionPath();
  if (!existsSync(path)) return null;

  const raw = readFileSync(path, 'utf-8').trim();
  if (!raw) return null;

  if (config.SESSION_ENCRYPTION_KEY) {
    return decryptSession(raw, config.SESSION_ENCRYPTION_KEY);
  }

  return raw;
}

export function saveSession(sessionString: string): void {
  const path = getSessionPath();

  if (config.SESSION_ENCRYPTION_KEY) {
    const encrypted = encryptSession(sessionString, config.SESSION_ENCRYPTION_KEY);
    writeFileSync(path, encrypted, 'utf-8');
  } else {
    writeFileSync(path, sessionString, 'utf-8');
  }

  logger.info('Session saved');
}

async function promptOtp(): Promise<string> {
  const { default: input } = await import('input');
  return await input.text('Enter the OTP sent to your Telegram account: ');
}

async function promptPassword(): Promise<string> {
  const { default: input } = await import('input');
  return await input.text('Enter your 2FA password: ');
}

export async function createClient(): Promise<TelegramClient> {
  const existingSession = loadSessionString();
  const stringSession = new StringSession(existingSession ?? '');

  const client = new TelegramClient(
    stringSession,
    config.API_ID,
    config.API_HASH,
    {
      connectionRetries: 3,
      deviceModel: DEVICE_MODEL,
      systemVersion: SYSTEM_VERSION,
      appVersion: APP_VERSION,
      langCode: 'en',
      systemLangCode: 'en-US',
    },
  );

  if (!existingSession) {
    await client.start({
      phoneNumber: config.PHONE,
      phoneCode: () => promptOtp(),
      password: () => promptPassword(),
      onError: (err) => {
        logger.error({ err }, 'Login error');
        throw err;
      },
    });
  } else {
    await client.connect();
  }

  const sessionStr = client.session.save() as unknown as string;
  saveSession(sessionStr);

  return client;
}
