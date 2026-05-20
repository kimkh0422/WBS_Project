#!/usr/bin/env node
/**
 * Git pre-commit hook:
 * - package.json 버전 patch 증가
 * - CHANGELOG.md / version.txt 갱신
 * - 갱신된 메타 파일을 staging 영역에 추가하여 같은 커밋에 포함시킨다
 *
 * pre-commit 단계에서 staging이 마무리되기 전에 실행되므로,
 * 여기서 git add 한 파일은 현재 진행 중인 커밋에 그대로 포함된다.
 *
 * (이전에는 commit-msg 훅으로 동작했지만, commit-msg 시점에는 staging이
 *  이미 닫혀 있어서 추가된 파일이 다음 커밋용으로 남는 사이클이 생겼다.)
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

try {
  execSync('node scripts/update-release.mjs patch "버전 업데이트"', { cwd: ROOT, stdio: 'inherit' });
  execSync('git add package.json package-lock.json CHANGELOG.md version.txt', { cwd: ROOT, stdio: 'inherit' });
} catch (e) {
  console.error('[version] 버전/CHANGELOG 자동 갱신 실패:', e?.message ?? e);
  process.exit(1);
}
