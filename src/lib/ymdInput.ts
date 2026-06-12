/** 인라인 날짜 키패드 입력 정규화: 'YYYY-MM-DD' | 'YYYYMMDD' | 'YYYY.MM.DD' | '2050년 7월 16일'(끝의 일·공백 허용) 등 → 'YYYY-MM-DD' (유효하지 않으면 ''). */
export function normalizeYmdInput(raw: string): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  // ISO 등 "2026-06-15T12:00:00Z" → 앞 10자만 (전부 숫자로만 파싱하면 8자리 규칙에 걸려 실패하던 버그)
  const head10 = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head10)) {
    const mi = parseInt(head10.slice(5, 7), 10);
    const di = parseInt(head10.slice(8, 10), 10);
    if (mi >= 1 && mi <= 12 && di >= 1 && di <= 31) return head10;
  }
  let y = '';
  let m = '';
  let d = '';
  // 표시용 toLocaleDateString('ko-KR') 복붙은 "…년 …월 …일"로 끝나므로, 일 뒤 비숫자 접미사를 허용한다.
  const sep = s.match(/^(\d{4})\s*[^\d]\s*(\d{1,2})\s*[^\d]\s*(\d{1,2})\s*[^\d]*$/);
  const digits = s.replace(/[^0-9]/g, '');
  if (sep) {
    [, y, m, d] = sep;
  } else if (digits.length === 8) {
    y = digits.slice(0, 4);
    m = digits.slice(4, 6);
    d = digits.slice(6, 8);
  } else {
    return '';
  }
  const mm = m.padStart(2, '0');
  const dd = d.padStart(2, '0');
  const mi = parseInt(mm, 10);
  const di = parseInt(dd, 10);
  if (!(mi >= 1 && mi <= 12 && di >= 1 && di <= 31)) return '';
  return `${y}-${mm}-${dd}`;
}
