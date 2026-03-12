import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import fs from 'fs';
import { execSync } from 'child_process';

/** CHANGELOG.md 파싱: "## v0.1.0 (2026-03-06)" + "- 항목" 목록 → { version, date, changes }[] */
function parseChangelog(changelogPath: string): { version: string; date: string; changes: string[] }[] {
  if (!fs.existsSync(changelogPath)) return [];
  const raw = fs.readFileSync(changelogPath, 'utf-8');
  const sections: { version: string; date: string; changes: string[] }[] = [];
  const re = /##\s+v?([\d.]+)\s*\((\d{4}-\d{2}-\d{2})\)\s*\n((?:(?:-\s*.+)\n?)+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const changes = m[3]
      .trim()
      .split('\n')
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
  const changelogPath = path.resolve(__dirname, 'CHANGELOG.md');
  const changelogSections = parseChangelog(changelogPath);

  return {
    plugins: [react(), tailwindcss()],
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
