/**
 * Supabase Edge Function — 협조 요청 알림 메일 발송 (회사 SMTP).
 *
 * 호출 페이로드:
 *   {
 *     requestId: string,            // cooperation_requests.id
 *     mode?: 'created' | 'updated' | 'status-change',
 *   }
 *
 * 동작:
 *   1) requestId 로 cooperation_requests 행을 읽어 memberProgress 추출
 *   2) memberProgress 의 각 (name, department, position) 으로 org_members 에서 email 찾기
 *   3) email 이 있는 멤버에게 회사 SMTP 로 메일 발송 (BCC 일괄)
 *
 * 필요 환경변수(Edge Function Secrets):
 *   - SMTP_HOST:  회사 메일 서버 (예: mail.gmtc.kr)
 *   - SMTP_PORT:  465(SSL) 또는 587(STARTTLS). 기본 465.
 *   - SMTP_USER:  발송 계정(이메일)
 *   - SMTP_PASS:  계정 비밀번호 또는 앱 비밀번호
 *   - MAIL_FROM:  발신자 표시 (예: "협조요청 <coop@gmtc.kr>")
 *   - APP_URL:    앱 접속 URL (메일 본문의 "바로가기" 링크에 사용)
 *
 * 호출(클라이언트):
 *   await supabase.functions.invoke('send-cooperation-email', { body: { requestId, mode: 'created' } });
 *
 * 비고:
 *   - email 이 비어 있는 멤버는 자동 스킵
 *   - SMTP_HOST 미설정이면 200 + skipped 반환(설정 전에도 협조요청 동작 보장)
 */

// @ts-expect-error — Deno 런타임은 npm 패키지 url import 지원
import { createClient } from 'jsr:@supabase/supabase-js@2';
// @ts-expect-error — denomailer 는 Deno 표준 SMTP 클라이언트 (도메인 인증 불필요)
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

interface RequestRow {
  id: string;
  mgmt_id: string | null;
  request_date: string | null;
  request_type: string | null;
  title: string | null;
  detail: string | null;
  requester: string | null;
  assignee: string | null;
  priority: string | null;
  due_date: string | null;
  status: string | null;
  member_progress: MemberSnap[] | null;
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

interface OrgMemberWithEmail {
  name: string;
  department: string;
  position: string;
  email: string | null;
}

const ALLOWED_MODES = new Set(['created', 'updated', 'status-change']);

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildEmail(row: RequestRow, mode: string, appUrl: string): { subject: string; html: string; text: string } {
  const mgmtId = row.mgmt_id ?? '(관리ID 없음)';
  const title = row.title ?? '(제목 없음)';
  const action =
    mode === 'created'
      ? '새 업무 협조 요청이 등록되었습니다'
      : mode === 'status-change'
        ? '협조 요청 현황이 변경되었습니다'
        : '협조 요청 내용이 갱신되었습니다';
  const subject = `[협조요청] ${mgmtId} ${title}`;

  const fields: Array<[string, string]> = [
    ['관리ID', mgmtId],
    ['제목', title],
    ['요청구분', row.request_type ?? '-'],
    ['요청자', row.requester ?? '-'],
    ['담당', row.assignee ?? '-'],
    ['중요도', row.priority ?? '-'],
    ['요청일', row.request_date ?? '-'],
    ['기한', row.due_date ?? '-'],
    ['현황', row.status ?? '-'],
  ];

  const fieldsHtml = fields
    .map(
      ([k, v]) =>
        `<tr><th style="text-align:left;padding:6px 10px;background:#f6f7fb;color:#6b7280;font-weight:600;width:120px">${escapeHtml(
          k,
        )}</th><td style="padding:6px 10px;color:#111827">${escapeHtml(v)}</td></tr>`,
    )
    .join('');

  const detailHtml = row.detail
    ? `<div style="margin-top:16px;padding:12px;background:#fafafa;border-left:3px solid #6366f1;color:#111827;white-space:pre-wrap">${escapeHtml(
        row.detail,
      )}</div>`
    : '';

  const link = appUrl
    ? `<p style="margin-top:20px"><a href="${escapeHtml(
        appUrl,
      )}/dashboard" style="display:inline-block;padding:10px 16px;background:#6366f1;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">앱에서 열기</a></p>`
    : '';

  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Apple SD Gothic Neo,Noto Sans KR,sans-serif;color:#111827;line-height:1.55">
  <div style="max-width:640px;margin:0 auto;padding:24px">
    <h2 style="margin:0 0 6px;color:#4f46e5">${escapeHtml(action)}</h2>
    <p style="margin:0 0 16px;color:#6b7280">아래 내용을 확인해 주세요.</p>
    <table style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">${fieldsHtml}</table>
    ${detailHtml}
    ${link}
    <p style="margin-top:24px;color:#9ca3af;font-size:12px">본 메일은 협조 요청 등록/변경 시 자동 발송됩니다.</p>
  </div>
</body></html>`;

  const text = `[협조요청] ${mgmtId} ${title}

${action}.

${fields.map(([k, v]) => `${k}: ${v}`).join('\n')}

${row.detail ?? ''}

${appUrl ? `${appUrl}/dashboard` : ''}
`;

  return { subject, html, text };
}

// @ts-expect-error — Deno 전역
Deno.serve(async (req: Request) => {
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
  const SMTP_HOST = Deno.env.get('SMTP_HOST') ?? '';
  // @ts-expect-error — Deno 전역
  const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '465');
  // @ts-expect-error — Deno 전역
  const SMTP_USER = Deno.env.get('SMTP_USER') ?? '';
  // @ts-expect-error — Deno 전역
  const SMTP_PASS = Deno.env.get('SMTP_PASS') ?? '';
  // @ts-expect-error — Deno 전역
  const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? SMTP_USER;
  // @ts-expect-error — Deno 전역
  const APP_URL = Deno.env.get('APP_URL') ?? '';

  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonResponse(500, { error: 'supabase env missing' });
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return jsonResponse(200, { skipped: true, reason: 'mail not configured (SMTP_HOST/SMTP_USER/SMTP_PASS)' });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 1) 협조요청 행 조회
  const { data: row, error: rowErr } = await supabase
    .from('cooperation_requests')
    .select('id, mgmt_id, request_date, request_type, title, detail, requester, assignee, priority, due_date, status, member_progress')
    .eq('id', requestId)
    .single();
  if (rowErr || !row) return jsonResponse(404, { error: 'request not found', detail: rowErr?.message });
  const reqRow = row as RequestRow;
  const members: MemberSnap[] = Array.isArray(reqRow.member_progress) ? reqRow.member_progress : [];
  if (members.length === 0) return jsonResponse(200, { sent: 0, skipped: 'no members' });

  // 2) 멤버 (name, department, position) → email 매핑
  const { data: omRows, error: omErr } = await supabase
    .from('org_members')
    .select('name, department, position, email')
    .order('sort_order', { ascending: true });
  if (omErr) return jsonResponse(500, { error: 'org_members fetch failed', detail: omErr.message });

  const orgMembers = (omRows ?? []) as OrgMemberWithEmail[];
  const key = (n: string, d: string, p: string) => `${n}||${d}||${p}`;
  const emailByKey = new Map<string, string>();
  for (const om of orgMembers) {
    if (om.email && om.email.trim()) emailByKey.set(key(om.name, om.department, om.position), om.email.trim());
  }

  const toAddresses = new Set<string>();
  const skippedMembers: string[] = [];
  for (const m of members) {
    if (m.status === '완료' || m.status === '회신불가') continue;
    const e = emailByKey.get(key(m.name, m.department, m.position));
    if (e) toAddresses.add(e);
    else skippedMembers.push(`${m.name}(${m.department})`);
  }

  if (toAddresses.size === 0) {
    return jsonResponse(200, { sent: 0, skipped: 'no recipient emails', skippedMembers });
  }

  // 3) SMTP 발송 (BCC 일괄)
  const { subject, html, text } = buildEmail(reqRow, mode, APP_URL);

  const client = new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      // 465 = implicit TLS, 587/25 = STARTTLS
      tls: SMTP_PORT === 465,
      auth: { username: SMTP_USER, password: SMTP_PASS },
    },
  });

  try {
    await client.send({
      from: MAIL_FROM,
      to: MAIL_FROM, // 자기 자신
      bcc: Array.from(toAddresses), // 실제 수신자
      subject,
      content: text,
      html,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    return jsonResponse(502, { error: 'smtp send failed', detail: msg });
  }

  await client.close();

  return jsonResponse(200, {
    sent: toAddresses.size,
    recipients: Array.from(toAddresses),
    skippedMembers,
    mode,
  });
});
