import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import fs from 'fs';
import { execSync } from 'child_process';

/** CHANGELOG 파싱: "## v0.1.0 (YYYY-MM-DD)" + "- 항목" 목록 → { version, date, changes }[] (섹션 사이 빈 줄·\r\n 허용) */
function parseChangelog(changelogPath: string): { version: string; date: string; changes: string[] }[] {
  if (!fs.existsSync(changelogPath)) return [];
  const raw = fs.readFileSync(changelogPath, 'utf-8').replace(/\r\n/g, '\n');
  const sections: { version: string; date: string; changes: string[] }[] = [];
  const re = /(?:^|\n)\s*##\s+v?([\d.]+)\s*\((\d{4}-\d{2}-\d{2})\)\s*\n((?:(?:-\s*.+)(?:\r?\n)?)+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const changes = m[3]
      .trim()
      .split(/\r?\n/)
      .map((line) => line.replace(/^-\s*/, '').trim())
      .filter(Boolean);
    sections.push({ version: m[1], date: m[2], changes });
  }
  return sections;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const commitDate = (() => {
    try {
      return execSync('git log -1 --format=%cI', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return new Date().toISOString();
    }
  })();
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
  const appVersion = (pkg && typeof pkg.version === 'string') ? pkg.version : '0.0.0';
  // 앱 '변경이력' 메뉴 표시용: docs/변경이력_주요기능.md 우선, 없거나 비면 CHANGELOG.md 사용
  const changelogPath = path.resolve(__dirname, 'docs/변경이력_주요기능.md');
  const fallbackChangelogPath = path.resolve(__dirname, 'CHANGELOG.md');
  let changelogSections = parseChangelog(changelogPath);
  if (changelogSections.length === 0) changelogSections = parseChangelog(fallbackChangelogPath);

  return {
    plugins: [
      react(),
      tailwindcss(),
      // 브라우저가 자동으로 요청하는 "기본 리소스"가 없을 때(특히 개발 중)
      // 콘솔에 404가 반복적으로 찍히는 것을 방지한다.
      {
        name: 'silence-missing-default-assets',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = (req.url || '').split('?')[0] || '';
            const shouldSilence =
              url === '/favicon.ico' ||
              url === '/manifest.json' ||
              url === '/manifest.webmanifest' ||
              url === '/site.webmanifest' ||
              url === '/apple-touch-icon.png';
            if (!shouldSilence) return next();
            res.statusCode = 204;
            res.end();
          });
        },
      },
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      '__APP_VERSION__': JSON.stringify(appVersion),
      '__APP_COMMIT_DATE__': JSON.stringify(commitDate),
      '__APP_CHANGELOG_JSON__': JSON.stringify(changelogSections),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: true, // Expose on local network
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
