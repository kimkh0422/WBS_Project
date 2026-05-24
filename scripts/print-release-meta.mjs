#!/usr/bin/env node
/**
 * pre-push 등에서 현재 package.json 버전과 오늘 날짜(로컬)를 한 줄로 출력합니다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');

const todayLocal = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

try {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  const v = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  const dateStr = todayLocal();
  console.log(`[릴리스] v${v} · 빌드 기준일 ${dateStr} (로컬)`);
} catch (e) {
  console.warn('[릴리스] package.json 읽기 실패:', e?.message ?? e);
  process.exit(0);
}
