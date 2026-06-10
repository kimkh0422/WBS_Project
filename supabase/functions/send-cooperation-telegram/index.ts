/**
 * Supabase Edge Function — 협조 요청 텔레그램 알림 발송 (Telegram Bot API).
 *
 * 호출 페이로드:
 *   {
 *     requestId: string,            // cooperation_requests.id
 *     mode?: 'created' | 'updated' | 'status-change',
 *   }
 *
 * 동작:
 *   1) requestId 로 cooperation_requests 행을 읽어 memberProgress 추출
 *   2) memberProgress 의 각 (name, department, position) 으로 org_members 에서 telegram_chat_id 찾기
 *   3) chat_id 가 있는 멤버에게 봇 메시지 발송 + TELEGRAM_DEFAULT_CHAT_ID(그룹방)가 있으면 그룹방에도 발송
 *
 * 필요 환경변수(Edge Function Secrets):
 *   - TELEGRAM_BOT_TOKEN:      BotFather 로 발급받은 봇 토큰 (예: 123456:ABC-DEF...)
 *   - TELEGRAM_DEFAULT_CHAT_ID: (선택) 기본 발송 대상 chat_id. 콤마(,)로 여러 개 지정 가능(개인+그룹, 다중 그룹 등).
 *                               예) "-5223913700"  또는  "-5223913700,8110778151"
 *                               설정 시 모든 협조요청 알림이 이 대상(들)에 항상 발송됨. 멤버별 chat_id 입력 전에도 운영 가능.
 *   - APP_URL:                 앱 접속 URL (메시지의 "앱에서 열기" 링크에 사용)
 *
 * 호출(클라이언트):
 *   await supabase.functions.invoke('send-cooperation-telegram', { body: { requestId, mode: 'created' } });
 *
 * 비고:
 *   - telegram_chat_id 가 비어 있는 멤버는 자동 스킵 (그룹방 발송은 별개로 항상 수행)
 *   - TELEGRAM_BOT_TOKEN 미설정이면 200 + skipped 반환(설정 전에도 협조요청 동작 보장)
 *   - 메시지는 HTML parse mode. 텔레그램 메시지 길이 한도(4096자)에 맞춰 상세내용은 잘라서 발송.
 */

// @ts-expect-error — Deno 런타임은 npm 패키지 url import 지원
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface RequestRow {
  id: string;
  mgmt_id: string | null;
  request_date: string | null;
  request_type: string | null;
  title: string | null;
  detail: string | null;
  deliverables: string | null;
  informees: string | null;
  requester: string | null;
  assignee: string | null;
  priority: string | null;
  due_date: string | null;
  status: string | null;
  member_progress: MemberSnap[] | null;
  meeting_logs: MeetingLogSnap[] | null;
}

interface MeetingLogSnap {
  id: string;
  date: string;
  title: string;
  content: string;
  actions?: { assignee: string; task: string; dueDate: string; done: boolean }[];
}

interface MemberSnap {
  name: string;
  department: string;
  position: string;
  status: string;
  completedAt?: string;
  direct?: boolean;
  sourceOrgIds?: string[];
}

interface OrgMemberWithChatId {
  name: string;
  department: string;
  position: string;
  telegram_chat_id: string | null;
}

const ALLOWED_MODES = new Set(['created', 'updated', 'status-change']);

/** CORS: 모든 origin 허용(앱이 어떤 도메인에서 호출하든 동작). 인증은 Supabase Functions 자체가 처리. */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

/** 텔레그램 HTML parse mode 이스케이프 — <, >, & 세 글자만 치환하면 된다. */
function escapeTgHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 텔레그램 메시지 본문(HTML) 구성. 4096자 한도 내로 상세내용을 자른다. */
function buildMessage(row: RequestRow, mode: string, appUrl: string): string {
  const mgmtId = row.mgmt_id ?? '(관리ID 없음)';
  const title = row.title ?? '(제목 없음)';
  const action =
    mode === 'created'
      ? '새 업무 협조 요청이 등록되었습니다'
      : mode === 'status-change'
        ? '협조 요청 현황이 변경되었습니다'
        : '협조 요청 내용이 갱신되었습니다';

  const fields: Array<[string, string]> = [
    ['요청구분', row.request_type ?? '-'],
    ['요청자', row.requester ?? '-'],
    ['담당', row.assignee ?? '-'],
    ['중요도', row.priority ?? '-'],
    ['요청일', row.request_date ?? '-'],
    ['요청기한', row.due_date ?? '-'],
    ['현황', row.status ?? '-'],
  ];
  if (row.deliverables && row.deliverables.trim()) fields.splice(1, 0, ['산출물', row.deliverables]);
  if (row.informees && row.informees.trim()) fields.push(['참조자', row.informees]);

  // RACI 카운트 요약
  const members = Array.isArray(row.member_progress) ? row.member_progress : [];
  if (members.length > 0) {
    const c: Record<string, number> = { R: 0, A: 0, C: 0, I: 0 };
    for (const m of members) {
      const r = (m as { raci?: string }).raci;
      if (r && c[r] !== undefined) c[r]++;
    }
    const tot = c.R + c.A + c.C + c.I;
    if (tot > 0) {
      const parts: string[] = [];
      if (c.R) parts.push(`R(실무자) ${c.R}`);
      if (c.A) parts.push(`A(의사결정자) ${c.A}`);
      if (c.C) parts.push(`C(협의처) ${c.C}`);
      if (c.I) parts.push(`I(공유처) ${c.I}`);
      fields.push(['RACI', parts.join(' · ')]);
    }
  }

  const head = `📋 <b>${escapeTgHtml(action)}</b>\n\n<b>[${escapeTgHtml(mgmtId)}] ${escapeTgHtml(title)}</b>\n`;
  const body = fields.map(([k, v]) => `· ${escapeTgHtml(k)}: ${escapeTgHtml(v)}`).join('\n');
  const link = appUrl ? `\n\n<a href="${escapeTgHtml(appUrl)}/dashboard">앱에서 열기</a>` : '';

  // 상세내용은 남는 길이만큼만 — 텔레그램 sendMessage 한도 4096자(이스케이프 후 기준 여유 둠).
  let detailBlock = '';
  if (row.detail && row.detail.trim()) {
    const budget = 3500 - (head.length + body.length + link.length);
    if (budget > 80) {
      const raw = row.detail.trim();
      const cut = raw.length > budget ? `${raw.slice(0, budget)}…` : raw;
      detailBlock = `\n\n<blockquote>${escapeTgHtml(cut)}</blockquote>`;
    }
  }

  return `${head}${body}${detailBlock}${link}`;
}

/** Bot API sendMessage 1건 발송. 성공 여부와 에러 설명을 반환. */
async function sendTelegram(token: string, chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (res.ok) return { ok: true };
    const errBody = (await res.json().catch(() => null)) as { description?: string } | null;
    return { ok: false, error: errBody?.description ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// @ts-expect-error — Deno 전역
Deno.serve(async (req: Request) => {
  // CORS preflight — 브라우저가 본 요청 전에 OPTIONS 로 미리 검사한다.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') return jsonResponse(405, { error: 'method not allowed' });

  let body: { requestId?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'invalid json' });
  }
  const requestId = body.requestId;
  const mode = body.mode && ALLOWED_MODES.has(body.mode) ? body.mode : 'created';
  if (!requestId) return jsonResponse(400, { error: 'requestId required' });

  // @ts-expect-error — Deno 전역
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  // @ts-expect-error — Deno 전역
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  // @ts-expect-error — Deno 전역
  const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
  // @ts-expect-error — Deno 전역
  // 콤마(,)로 여러 chat_id 지정 가능(개인+그룹, 다중 그룹 등). 공백·빈 항목은 제거.
  const DEFAULT_CHAT_IDS = (Deno.env.get('TELEGRAM_DEFAULT_CHAT_ID') ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);
  // @ts-expect-error — Deno 전역
  const APP_URL = Deno.env.get('APP_URL') ?? '';

  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonResponse(500, { error: 'supabase env missing' });
  if (!BOT_TOKEN) {
    return jsonResponse(200, { skipped: true, reason: 'telegram not configured (TELEGRAM_BOT_TOKEN)' });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 1) 협조요청 행 조회
  const { data: row, error: rowErr } = await supabase
    .from('cooperation_requests')
    .select(
      'id, mgmt_id, request_date, request_type, title, detail, deliverables, informees, requester, assignee, priority, due_date, status, member_progress, meeting_logs',
    )
    .eq('id', requestId)
    .single();
  if (rowErr || !row) return jsonResponse(404, { error: 'request not found', detail: rowErr?.message });
  const reqRow = row as RequestRow;
  const members: MemberSnap[] = Array.isArray(reqRow.member_progress) ? reqRow.member_progress : [];

  // 2) 멤버 (name, department, position) → telegram_chat_id 매핑
  //    컬럼 미적용(마이그레이션 전) DB에서도 함수 전체가 죽지 않도록 조회 실패는 빈 목록으로 처리.
  const chatIds = new Set<string>();
  const skippedMembers: string[] = [];
  if (members.length > 0) {
    const { data: omRows, error: omErr } = await supabase
      .from('org_members')
      .select('name, department, position, telegram_chat_id')
      .order('sort_order', { ascending: true });
    if (omErr && DEFAULT_CHAT_IDS.length === 0) {
      return jsonResponse(500, { error: 'org_members fetch failed', detail: omErr.message });
    }
    const orgMembers = (omErr ? [] : (omRows ?? [])) as OrgMemberWithChatId[];
    const key = (n: string, d: string, p: string) => `${n}||${d}||${p}`;
    const chatIdByKey = new Map<string, string>();
    for (const om of orgMembers) {
      if (om.telegram_chat_id && om.telegram_chat_id.trim())
        chatIdByKey.set(key(om.name, om.department, om.position), om.telegram_chat_id.trim());
    }
    for (const m of members) {
      if (m.status === '완료' || m.status === '회신불가') continue;
      const c = chatIdByKey.get(key(m.name, m.department, m.position));
      if (c) chatIds.add(c);
      else skippedMembers.push(`${m.name}(${m.department})`);
    }
  }

  // 기본 발송 대상(개인·그룹 등 다중)은 멤버 유무와 무관하게 항상 포함.
  for (const id of DEFAULT_CHAT_IDS) chatIds.add(id);

  if (chatIds.size === 0) {
    return jsonResponse(200, { sent: 0, skipped: 'no telegram chat ids', skippedMembers });
  }

  // 3) Bot API 발송 — 순차 발송(텔레그램 초당 발송 한도 보호). 일부 실패해도 나머지는 계속.
  const text = buildMessage(reqRow, mode, APP_URL);
  let sent = 0;
  const failures: Array<{ chatId: string; error: string }> = [];
  for (const chatId of chatIds) {
    const r = await sendTelegram(BOT_TOKEN, chatId, text);
    if (r.ok) sent += 1;
    else failures.push({ chatId, error: r.error ?? 'unknown' });
  }

  if (sent === 0) {
    return jsonResponse(502, { error: 'telegram send failed', failures, skippedMembers });
  }

  return jsonResponse(200, { sent, failed: failures.length, failures, skippedMembers, mode });
});
