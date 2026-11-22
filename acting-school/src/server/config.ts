import path from 'node:path';

export interface AppConfig {
  /** Where app.db and uploads/ live. */
  dataDir: string;
  uploadsDir: string;
  /** Send the session cookie with `Secure` (on behind HTTPS). */
  cookieSecure: boolean;
  sessionDays: number;
  isProduction: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = path.resolve(env.DATA_DIR ?? 'data');
  const isProduction = env.NODE_ENV === 'production';
  return {
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    // Default: secure cookies in production. Set COOKIE_SECURE=false only to try a
    // production build over plain http on a private network.
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction,
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    isProduction,
  };
}
