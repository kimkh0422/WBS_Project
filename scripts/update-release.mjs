#!/usr/bin/env node
/**
 * 커밋 후 버전·CHANGELOG 갱신 스크립트
 * 사용: node scripts/update-release.mjs [patch|minor|major] ["변경 내용"]
 * 변경 내용 생략 시 최근 커밋 메시지를 항목으로 추가
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');
const VERSION_TXT_PATH = path.join(ROOT, 'version.txt');

const bump = (version, type) => {
  const [major, minor, patch] = version.split('.').map(Number);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};

const today = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// 1) 버전 올리기
const versionType = (process.argv[2] || 'patch').toLowerCase();
if (!['patch', 'minor', 'major'].includes(versionType)) {
  console.error('Usage: node scripts/update-release.mjs [patch|minor|major] ["변경 내용 한 줄"]');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
const prev = pkg.version;
const next = bump(prev, versionType);
pkg.version = next;
fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
console.log(`package.json 버전: ${prev} → ${next}`);

// version.txt도 함께 갱신 (push.bat / 표시용)
try {
  fs.writeFileSync(VERSION_TXT_PATH, `${next}\n`);
} catch {
  // ignore
}

// 2) 변경 내용: 인자로 받거나 최근 커밋 메시지
let changeLines = process.argv[3]
  ? [process.argv[3]]
  : (() => {
      try {
        const msg = execSync('git log -1 --pretty=%B', { encoding: 'utf-8', cwd: ROOT }).trim();
        return msg
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 15);
      } catch {
        return [`버전 ${next} 업데이트`];
      }
    })();

if (changeLines.length === 0) changeLines = [`버전 ${next} 업데이트`];

// 3) CHANGELOG.md에 새 섹션 추가
const dateStr = today();
const section = [
  '',
  `## v${next} (${dateStr})`,
  ...changeLines.map((line) => `- ${line}`),
  ''
].join('\n');

let changelog = fs.readFileSync(CHANGELOG_PATH, 'utf-8');
// "## v" 로 시작하는 첫 번째 블록 앞에 삽입
const insertAt = changelog.indexOf('\n## v');
if (insertAt !== -1) {
  changelog = changelog.slice(0, insertAt + 1) + section + changelog.slice(insertAt + 1);
} else {
  changelog = changelog.trimEnd() + '\n' + section;
}
fs.writeFileSync(CHANGELOG_PATH, changelog);
console.log(`CHANGELOG.md에 v${next} (${dateStr}) 항목 추가됨.`);
console.log('이제 빌드/재시작 시 헤더 버전·수정일·버전 히스토리가 반영됩니다.');
