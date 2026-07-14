/** Required env var - throws if missing. */
export function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing ${key} - set it in .env`);
  return v;
}

/** Optional env var with a demo default. */
export function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}
