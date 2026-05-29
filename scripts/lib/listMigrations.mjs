import { readdirSync } from 'fs';
import { join } from 'path';

/** supabase/migrations 내 타임스탬프 마이그레이션만 시간순 반환 */
export function listOrderedMigrations(migrationsDir) {
  return readdirSync(migrationsDir)
    .filter((f) => /^\d{8,}_.+\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b))
    .map((f) => join(migrationsDir, f));
}
