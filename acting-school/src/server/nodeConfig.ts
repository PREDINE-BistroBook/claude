import path from 'node:path';
import { configFromVars, type AppConfig } from './config';

/** The Node server's config: AppConfig plus where the data folder is. */
export interface NodeConfig extends AppConfig {
  /** Where app.db and uploads/ live (DATA_DIR, default ./data). */
  dataDir: string;
  uploadsDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): NodeConfig {
  const dataDir = path.resolve(env.DATA_DIR ?? 'data');
  const isProduction = env.NODE_ENV === 'production';
  return {
    // Default: secure cookies in production.
    ...configFromVars(env, { cookieSecure: isProduction, isProduction, requireSetupCode: false }),
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
  };
}
