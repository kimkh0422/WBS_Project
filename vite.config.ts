import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import fs from 'fs';
import { execSync } from 'child_process';

const VIRTUAL_APP_RELEASE = '\0virtual:app-release';
const VIRTUAL_APP_RELEASE_ID = 'virtual:app-release';

/** CHANGELOG 파싱: "## v0.1.0 (YYYY-MM-DD [HH:mm])" + "- 항목" 목록 → { version, date, changes }[] (섹션 사이 빈 줄·\r\n 허용) */
function parseChangelog(changelogPath: string): { version: string; date: string; changes: string[] }[] {
  if (!fs.existsSync(changelogPath)) return [];
  const raw = fs.readFileSync(changelogPath, 'utf-8').replace(/\r\n/g, '\n');
  const sections: { version: string; date: string; changes: string[] }[] = [];
  const re = /(?:^|\n)\s*##\s+v?([\d.]+)\s*\(\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\s*\)\s*\n((?:(?:-\s*.+)(?:\r?\n)?)+)/g;
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

/** CHANGELOG 괄호 안 문자열 → APP_COMMIT_DATE용 ISO (날짜만이면 기존과 같이 정오 KST 플레이스홀더) */
function releaseChangelogDateToIso(parenDate: string): string {
  const trimmed = parenDate.trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}):(\d{2}))?$/.exec(trimmed);
  if (!m) return new Date().toISOString();
  const ymd = m[1];
  const hh = m[2];
  const mm = m[3];
  if (hh != null && mm != null) {
    const d = new Date(`${ymd}T${hh}:${mm}:00`);
    return Number.isNaN(d.getTime()) ? `${ymd}T12:00:00+09:00` : d.toISOString();
  }
  return `${ymd}T12:00:00+09:00`;
}

function computeReleaseMeta(root: string): {
  appVersion: string;
  commitDate: string;
  changelogSections: { version: string; date: string; changes: string[] }[];
} {
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const appVersion = pkg && typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  const changelogPath = path.join(root, 'docs', '변경이력_주요기능.md');
  const fallbackChangelogPath = path.join(root, 'CHANGELOG.md');
  let changelogSections = parseChangelog(changelogPath);
  if (changelogSections.length === 0) changelogSections = parseChangelog(fallbackChangelogPath);
  const releaseChangelogSections = parseChangelog(fallbackChangelogPath);
  const commitDate = (() => {
    const releaseDate =
      releaseChangelogSections.find((s) => s.version === appVersion)?.date ?? changelogSections.find((s) => s.version === appVersion)?.date;
    if (releaseDate) return releaseChangelogDateToIso(releaseDate);
    try {
      return execSync('git log -1 --format=%cI', { stdio: ['ignore', 'pipe', 'ignore'], cwd: root })
        .toString()
        .trim();
    } catch {
      return new Date().toISOString();
    }
  })();
  return { appVersion, commitDate, changelogSections };
}

/** define 캐시로 dev에서 구버전이 남는 문제 방지: 메타 파일을 watch하고 load 시마다 최신값 생성 */
function virtualAppReleasePlugin(root: string): Plugin {
  return {
    name: 'virtual-app-release',
    resolveId(id) {
      if (id === VIRTUAL_APP_RELEASE_ID) return VIRTUAL_APP_RELEASE;
    },
    load(id) {
      if (id !== VIRTUAL_APP_RELEASE) return null;
      this.addWatchFile(path.join(root, 'package.json'));
      this.addWatchFile(path.join(root, 'CHANGELOG.md'));
      const docsChangelog = path.join(root, 'docs', '변경이력_주요기능.md');
      if (fs.existsSync(docsChangelog)) this.addWatchFile(docsChangelog);

      const { appVersion, commitDate, changelogSections } = computeReleaseMeta(root);
      const changelogJson = JSON.stringify(changelogSections);
      return [
        `export const APP_VERSION = ${JSON.stringify(appVersion)};`,
        `export const APP_COMMIT_DATE = ${JSON.stringify(commitDate)};`,
        `export const APP_CHANGELOG_JSON = ${JSON.stringify(changelogJson)};`,
      ].join('\n');
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const root = path.resolve(__dirname);

  return {
    plugins: [
      virtualAppReleasePlugin(root),
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
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-xlsx': ['xlsx'],
            'vendor-datefns': ['date-fns'],
            'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
            'vendor-tiptap': [
              '@tiptap/react',
              '@tiptap/starter-kit',
              '@tiptap/extension-collaboration',
              '@tiptap/extension-collaboration-cursor',
            ],
            'vendor-yjs': ['yjs'],
            'vendor-motion': ['motion'],
            'vendor-uuid': ['uuid'],
          },
        },
      },
    },
    server: {
      host: true,
      // PORT 환경변수가 있으면 그 포트를 사용(프리뷰가 빈 포트를 할당). 없으면 기존대로 3000.
      port: process.env.PORT ? Number(process.env.PORT) : 3000,
      /** 기본 포트가 사용 중이면 Vite가 다음 사용 가능 포트로 자동 전환 */
      strictPort: false,
      // 내부망(사내 LAN)에서 IP/호스트네임/도메인 어떤 형태로 접속해도
      // Vite의 host 헤더 검증에 차단되지 않도록 모든 호스트 허용
      allowedHosts: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    preview: {
      host: true,
      port: 3000,
      strictPort: false,
      allowedHosts: true,
    },
  };
});
