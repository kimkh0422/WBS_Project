import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PROJECT_REF_RE = /VITE_SUPABASE_URL\s*=\s*["']?https?:\/\/([a-z0-9]+)\.supabase\.co/i;

/** .env 한 줄에서 KEY=값 추출 (따옴표·공백 허용) */
export function parseEnvLineValue(line, key) {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`);
  const m = line.match(re);
  if (!m) return null;
  let v = m[1].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v || null;
}

export function readEnvFile(cwd = process.cwd()) {
  try {
    return readFileSync(join(cwd, '.env'), 'utf8');
  } catch {
    return null;
  }
}

export function getProjectRef(cwd = process.cwd()) {
  const env = readEnvFile(cwd);
  if (env) {
    const m = env.match(PROJECT_REF_RE);
    if (m) return m[1];
  }
  try {
    const toml = readFileSync(join(cwd, 'supabase/config.toml'), 'utf8');
    const m = toml.match(/^\s*project_id\s*=\s*["']?([a-z0-9]+)["']?\s*$/m);
    if (m) return m[1];
  } catch {}
  return null;
}

/** supabase link 후 생성되는 Session pooler URL 템플릿(비밀번호 없음) */
export function getPoolerUrlTemplate(cwd = process.cwd()) {
  const path = join(cwd, 'supabase/.temp/pooler-url');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8').trim();
    return raw.includes('pooler.supabase.com') ? raw : null;
  } catch {
    return null;
  }
}

export function withPasswordInPostgresUrl(template, password) {
  const parsed = new URL(template.replace(/^postgresql:\/\//i, 'http://'));
  const enc = encodeURIComponent(password);
  const port = parsed.port ? `:${parsed.port}` : '';
  return `postgresql://${parsed.username}:${enc}@${parsed.hostname}${port}${parsed.pathname}`;
}

export function ensureSslMode(url) {
  // pooler는 pg.Client.ssl로 처리 (URL의 sslmode=verify-full이 Windows에서 실패하는 경우 방지)
  if (/pooler\.supabase\.com/i.test(url)) return url;
  if (/sslmode=/i.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}sslmode=require`;
}

function readEnvKeys(cwd) {
  const env = readEnvFile(cwd);
  const out = { dbUrl: null, password: null };
  if (!env) return out;
  for (const line of env.split(/\r?\n/)) {
    if (!out.dbUrl) out.dbUrl = parseEnvLineValue(line, 'SUPABASE_DB_URL');
    if (!out.password) out.password = parseEnvLineValue(line, 'SUPABASE_DB_PASSWORD');
  }
  return out;
}

/**
 * CLI용 Postgres 연결 문자열.
 * Windows 등 IPv4-only 환경에서는 db.{ref}.supabase.co(IPv6) 대신 pooler를 우선 사용.
 */
export function resolveSupabaseDbUrl(cwd = process.cwd()) {
  const fromFile = readEnvKeys(cwd);
  if (fromFile.dbUrl) return ensureSslMode(fromFile.dbUrl);
  if (process.env.SUPABASE_DB_URL) return ensureSslMode(process.env.SUPABASE_DB_URL);

  const password = fromFile.password || process.env.SUPABASE_DB_PASSWORD || null;
  if (!password) return null;

  const poolerTemplate = getPoolerUrlTemplate(cwd);
  if (poolerTemplate) {
    return ensureSslMode(withPasswordInPostgresUrl(poolerTemplate, password));
  }

  const projectRef = getProjectRef(cwd);
  if (!projectRef) return null;

  return ensureSslMode(
    `postgresql://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres`,
  );
}
