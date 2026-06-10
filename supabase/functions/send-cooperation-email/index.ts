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
 * 필요 환경변수(Edge Function Secrets) — 발송 방식 2가지 중 하나:
 *   [방식 A · 권장] Resend 전송 API — 클라우드에서 IP 제한 없이 발송:
 *   - RESEND_API_KEY: resend.com API 키(re_...). 설정 시 이 방식이 우선.
 *   - MAIL_FROM:      발신자 = Resend 인증 도메인의 주소. 예: "지엠티 협조요청 <noreply@send.gmtc.kr>"
 *   [방식 B] 회사/외부 SMTP(denomailer) — RESEND_API_KEY 미설정 시:
 *   - SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS: SMTP 접속 정보(465 SSL 기본)
 *   - MAIL_FROM:      발신자 표시 (예: "협조요청 <coop@gmtc.kr>")
 *   [공통]
 *   - APP_URL:        앱 접속 URL (메일 본문의 "앱에서 열기" 링크)
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

/** 알림 제외 대상 멤버 상태 — 구 어휘(완료·회신불가) + 신 어휘(처리완료·확인완료·취소됨) 모두 포함. */
const DONE_MEMBER_STATUSES = new Set(['완료', '회신불가', '처리완료', '확인완료', '취소됨']);

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
  // @ts-expect-error — Deno 전역
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonResponse(500, { error: 'supabase env missing' });
  // 발송 방식 결정: RESEND_API_KEY 가 있으면 Resend, 없으면 SMTP.
  const useResend = !!RESEND_API_KEY;
  const useSmtp = !useResend && !!SMTP_HOST && !!SMTP_USER && !!SMTP_PASS;
  if (!useResend && !useSmtp) {
    return jsonResponse(200, { skipped: true, reason: 'mail not configured (RESEND_API_KEY 또는 SMTP_HOST/USER/PASS)' });
  }
  if (useResend && !MAIL_FROM) {
    return jsonResponse(500, { error: 'MAIL_FROM required for Resend (예: "지엠티 협조요청 <noreply@send.gmtc.kr>")' });
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

  // 2) 수신 이메일 결정 — 우선순위: org_members.email(수동 입력) → profiles(가입 이메일, full_name 매칭)
  const key = (n: string, d: string, p: string) => `${n}||${d}||${p}`;

  // (a) org_members.email — 수동 입력 override. email 컬럼 미적용(마이그레이션 전)이어도 죽지 않게 실패는 무시.
  const emailByKey = new Map<string, string>();
  {
    const { data: omRows, error: omErr } = await supabase
      .from('org_members')
      .select('name, department, position, email')
      .order('sort_order', { ascending: true });
    if (!omErr) {
      for (const om of (omRows ?? []) as OrgMemberWithEmail[]) {
        if (om.email && om.email.trim()) emailByKey.set(key(om.name, om.department, om.position), om.email.trim());
      }
    }
  }

  // (b) profiles(가입 사용자) — full_name → 가입 이메일. 동명이인은 부서(department) 일치 우선.
  const profByName = new Map<string, Array<{ dept: string; email: string }>>();
  {
    const { data: profRows } = await supabase.from('profiles').select('full_name, department, email');
    for (const p of (profRows ?? []) as Array<{ full_name: string | null; department: string | null; email: string | null }>) {
      const name = (p.full_name ?? '').trim();
      const email = (p.email ?? '').trim();
      if (!name || !email) continue;
      const arr = profByName.get(name) ?? [];
      arr.push({ dept: (p.department ?? '').trim(), email });
      profByName.set(name, arr);
    }
  }
  const resolveProfileEmail = (name: string, dept: string): string | null => {
    const arr = profByName.get(name);
    if (!arr || arr.length === 0) return null;
    if (arr.length === 1) return arr[0].email;
    const byDept = arr.find((x) => x.dept && dept && x.dept === dept); // 동명이인 → 부서 일치 우선
    return (byDept ?? arr[0]).email;
  };

  const toAddresses = new Set<string>();
  const skippedMembers: string[] = [];
  for (const m of members) {
    if (DONE_MEMBER_STATUSES.has(m.status)) continue;
    const e = emailByKey.get(key(m.name, m.department, m.position)) ?? resolveProfileEmail(m.name, m.department);
    if (e) toAddresses.add(e);
    else skippedMembers.push(`${m.name}(${m.department})`);
  }

  if (toAddresses.size === 0) {
    return jsonResponse(200, { sent: 0, skipped: 'no recipient emails', skippedMembers });
  }

  // 3) 발송 — Resend(API) 우선, 없으면 SMTP.
  const { subject, html, text } = buildEmail(reqRow, mode, APP_URL);
  const recipients = Array.from(toAddresses);

  if (useResend) {
    // Resend 배치 API: 1인 1통으로 개별 발송(수신자끼리 주소 비노출). 요청당 최대 100건 → 100단위 청크.
    for (let i = 0; i < recipients.length; i += 100) {
      const chunk = recipients.slice(i, i + 100);
      const payload = chunk.map((addr) => ({ from: MAIL_FROM, to: [addr], subject, html, text }));
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return jsonResponse(502, { error: 'resend send failed', status: res.status, detail });
      }
    }
    return jsonResponse(200, { sent: recipients.length, recipients, skippedMembers, via: 'resend', mode });
  }

  // SMTP 발송 (BCC 일괄)
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
      bcc: recipients, // 실제 수신자
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

  return jsonResponse(200, { sent: recipients.length, recipients, skippedMembers, via: 'smtp', mode });
});
