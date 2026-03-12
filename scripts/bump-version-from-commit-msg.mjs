#!/usr/bin/env node
/**
 * Git hook (commit-msg):
 * - 커밋 메시지 1줄을 CHANGELOG 항목으로 사용
 * - package.json 버전 patch 증가
 * - CHANGELOG.md 갱신
 * - 두 파일을 자동 stage 해서 "같은 커밋"에 포함되도록 함
 *
 * simple-git-hooks가 이 파일을 commit-msg hook으로 호출합니다.
 * 인자: commit message 파일 경로 (.git/COMMIT_EDITMSG)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const msgFile = process.argv[2];
const raw = (() => {
  try {
    if (msgFile) return fs.readFileSync(msgFile, 'utf-8');
  } catch {
    // ignore
  }
  return '';
})();

// Git이 자동으로 넣는 주석/메타 라인 제외
const firstLine =
  raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#')) ?? '';

try {
  const quoted = JSON.stringify(firstLine || '버전 업데이트');
  execSync(`node scripts/update-release.mjs patch ${quoted}`, { cwd: ROOT, stdio: 'inherit' });
  execSync('git add package.json CHANGELOG.md version.txt', { cwd: ROOT, stdio: 'inherit' });
} catch (e) {
  // 훅 실패는 커밋 자체를 막는 게 더 낫다(버전/이력 불일치 방지)
  console.error('[version] 버전/CHANGELOG 자동 갱신 실패:', e?.message ?? e);
  process.exit(1);
}

