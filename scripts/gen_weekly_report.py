# -*- coding: utf-8 -*-
"""
지엠티 주간보고 통합.docx -> src/data/weeklyReport.html 의 REPORTS 배열 생성기.

  python scripts/gen_weekly_report.py diag    # 진단(보고 경계/표 헤더/행수)
  python scripts/gen_weekly_report.py gen     # REPORTS 생성·주입
  python scripts/gen_weekly_report.py summary # 조직별 섹션 카운트만 출력(주입 X)

원문은 조직마다 표 형식이 제각각(메가표/분리표, 컬럼 순서·명칭 상이)이라
'발신자 서명 블록 인덱스'로 보고를 분할하고, 문단(섹션 제목)+표 행을 순서대로
훑으며 헤더명 기반으로 컬럼을 매핑한다. 내용 셀은 ○ 대분류 + 하위 -/> 구조를 보존한다.
"""
import sys
import re
import json
import zipfile
from xml.etree import ElementTree as ET

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

DOCX = r"C:\Users\ejavm\OneDrive\文档\지엠티 주간보고 통합.docx"
HTML = r"E:\src\WBS_Project\src\data\weeklyReport.html"
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

# ── 조직 골격(현 사이드바 순서 유지) + Word 보고 종료(서명) 블록 인덱스 ──
# wordEnd: 해당 보고의 서명/푸터 블록 인덱스. (직전 보고 end < 표 인덱스 < 이 end) 의 표를 소유.
ORGS = [
    dict(id="r-strategy",   group="경영·전략기획",    icon="전략", org="전략기획실",                 reporter="김창민",        recipient="문병욱 대표이사", wordEnd=280),
    dict(id="r-bizplan",    group="경영·전략기획",    icon="기획", org="사업기획·영업",             reporter="이권우",        recipient="문병욱 대표이사", wordEnd=307),
    dict(id="r-hanggwan",   group="항행·항공 관제",   icon="항행", org="항행관제사업부",             reporter="양승호 사업부장", recipient="문병욱 대표이사", wordEnd=10),
    dict(id="r-aircontrol", group="항행·항공 관제",   icon="항공", org="항공관제사업팀",             reporter="김일웅 팀장",     recipient="양승호 이사",    wordEnd=78),
    dict(id="r-ict-dev",    group="해양 ICT 사업",    icon="ICT", org="ICT사업부 · 개발",           reporter="전인호",        recipient="김민엽 상무",    wordEnd=26),
    dict(id="r-ict-ops",    group="해양 ICT 사업",    icon="운영", org="ICT사업부 · 운영/유지보수",  reporter="고석영",        recipient="김민엽 상무",    wordEnd=43),
    dict(id="r-ict-head",   group="해양 ICT 사업",    icon="총괄", org="ICT사업부 · 총괄",           reporter="김민엽 상무",     recipient="문병욱 대표이사", wordEnd=101),
    dict(id="r-techdev",    group="솔루션·기술개발",  icon="기술", org="기술개발본부",               reporter="김현",          recipient="문병욱 대표이사", wordEnd=298),
    dict(id="r-solution",   group="솔루션·기술개발",  icon="솔루", org="솔루션사업부",               reporter="정태창",        recipient="문병욱 대표이사", wordEnd=322),
    dict(id="r-apptech",    group="솔루션·기술개발",  icon="응용", org="응용기술개발센터",           reporter="박성규",        recipient="김현 본부장",    wordEnd=117),
    dict(id="r-devcenter",  group="솔루션·기술개발",  icon="개발", org="개발센터",                   reporter="신동훈",        recipient="박성규 센터장",  wordEnd=59),
    dict(id="r-ailab",      group="솔루션·기술개발",  icon="AI",  org="AI개발실",                   reporter="서원택",        recipient="문병욱 대표이사", wordEnd=123),
    dict(id="r-dev-jmh",    group="솔루션·기술개발",  icon="개발", org="개발팀 (정민환)",            reporter="정민환",        recipient="김현 본부장",    wordEnd=132),
    dict(id="r-dev-pjh",    group="솔루션·기술개발",  icon="개발", org="개발팀 (박준호)",            reporter="박준호",        recipient="김현 본부장",    wordEnd=265),
    dict(id="r-navcomm",    group="항해통신",         icon="항통", org="항해통신사업부",             reporter="한규혁 부장",     recipient="문병욱 대표이사", wordEnd=209),
    dict(id="r-mtraffic",   group="해상교통·바다내비", icon="해교", org="해상교통정보팀 (바다내비)",  reporter="김태식",        recipient="문병욱 대표이사", wordEnd=162),
    dict(id="r-mobility",   group="모빌리티·제품",    icon="모빌", org="모빌리티 사업부",            reporter="신현빈",        recipient="문병욱 대표이사", wordEnd=245),
    dict(id="r-mobility2",  group="모빌리티·제품",    icon="모2", org="모빌리티사업2팀",            reporter="정기현",        recipient="신현빈 사업부장", wordEnd=146),
    dict(id="r-ecdis",      group="모빌리티·제품",    icon="ECD", org="ECDIS·GMDRT 개발",          reporter="양재훈",        recipient="기술개발본부",   wordEnd=196),
    dict(id="r-energy",     group="에너지 (해상풍력)", icon="에너", org="에너지사업부",               reporter="이덕수",        recipient="문병욱 대표이사", wordEnd=181),
    dict(id="r-energy-biz", group="에너지 (해상풍력)", icon="영업", org="에너지사업부 · 영업/기획",   reporter="주현석",        recipient="이덕수 사업부장", wordEnd=255),
    dict(id="r-rnd",        group="연구개발 (R&D)",   icon="R&D", org="R&D지원 (연구과제)",         reporter="송용학",        recipient="경영진",        wordEnd=227),
]

# Word 원문에 없는 보고(직접 전달분)는 여기에 표준 스키마로 추가 → gen 재실행 후에도 유지된다.
MANUAL_REPORTS = [
    {
        "id": "r-optech", "group": "연구개발 (R&D)", "icon": "운기",
        "org": "운영기술개발실", "reporter": "김길용 수석", "recipient": "이상재 상무",
        "projects": [
            {
                "name": "[KRISO] 위성항법 연구",
                "subtitle": "한국형 위성항법시스템 센티미터급 임무제어국 상세설계 분석 및 도출 연구 용역",
                "type": "용역", "period": "26.01.01~26.09.30", "po": "이상재", "pm": "김길용",
                "prog": {"plan": 67, "actual": 67},
                "content": [
                    "[설계단계]",
                    "1. CMCS 산출물 보완",
                    {"t": "1) 상세설계서 본문", "sub": [
                        "제목 미기입된 항목 제목 기입",
                        "데이터베이스 검증 방법 작성",
                        "컴포넌트 함수 목록 표 수정",
                        "통합운영센터를 통해 백업 임무제어국과 연동 내용 삭제(구축 방향 변경)",
                        "회의 간 수정을 위한 메모 삭제",
                        "목차 최신화",
                        "요구사항 추적성 출처 반영",
                    ]},
                    {"t": "2) 운영절차서", "sub": [
                        "운영절차서 본문 제작",
                        "부록 별도 첨부 파일로 제작",
                    ]},
                    {"t": "3) 인터페이스 상세설계서", "sub": [
                        "슈어소프트 검토 의견 분석",
                        "인터페이스 상세설계서 목차 내용 변경",
                        "인터페이스 상세설계서 요구사항 추적표 내용 변경",
                    ]},
                    {"t": "4) CMCS 3차 내부 검토 회의(5/28(목), 제주도 베니키아 중문 호텔)", "sub": [
                        "회의 목적: 상세 설계 및 검토 산출물 검토, 주요 이슈 및 인터페이스 조율",
                        "CPS/OS 기능 설계 및 gRPC·REST API 기반 인터페이스 구축 완료 단계",
                        "4단계 시험(단위·통합·시스템·인도) 절차 및 시나리오 초안 수립",
                        "상세설계(v1.0) 및 예비설계(v2.0) 산출물 공식 제출 준비",
                        "GPU 기반 알고리즘 최적화 및 PostgreSQL DB(오라클 전환 고려) 설계",
                    ]},
                ],
                "note": "김경환(2.5D) · 최우혁(3D)",
            },
            {
                "name": "[LS전선] AI팩토리 연구",
                "subtitle": "고하중 장조장 해저 케이블 생산을 위한 디지털 트윈 AI 팩토리 기술 개발",
                "type": "연구", "period": "26.01.01~28.12.31", "po": "이상재", "pm": "김길용",
                "prog": {"plan": 90, "actual": 90},
                "content": [
                    "[요구분석 단계]",
                    {"t": "1. 군산 공정 시뮬레이션 제작", "sub": [
                        "공정 시뮬레이션 제작 및 LS전선 피드백 반영",
                        "추가 디스플레이 배치 및 가시성 수정",
                        "SCR, 큐 플레이크 적재 디스플레이 오류 수정",
                        "적재소가 가득차면 트랙터가 무한히 왕복하는 버그 수정",
                    ]},
                ],
                "note": "김홍태(1D) · 정회성(3D) · 최우혁(0.5D)",
            },
            {
                "name": "[내부] ECDIS 개발 및 인증",
                "type": "내부", "period": "26.01.01~26.07.31", "po": "김길용", "pm": "박서준",
                "prog": {"plan": 42, "actual": 37},
                "content": [
                    "[검증 단계]",
                    {"t": "1. 내부 QA (S-64표준)", "sub": [
                        "전체 시험 항목 614건 중 누적 231건 QA 완료",
                        "IEC-62288 시험 절차서 수정 완료",
                        "IEC-62288 PASS 22건 FAIL 9건 총 31건 시험 완료",
                        "IEC-62288 문서검토 104건 완료",
                        "IEC-62288 ANNEX A 문서검토 51건 완료",
                    ]},
                    {"t": "2. 기타", "sub": [
                        "테스트 시뮬레이터 개발, 614개 항목 중 테스트 시뮬레이터 사용이 필요한 항목 검토",
                        "RIMS에 문의할 질문사항 취합 및 검토",
                    ]},
                ],
                "note": "김길용(0.5D) · 박서준(2D) · 정회성(1D) · 권순환(1D) · 최우혁(0.5D) · 김경환(1.5D)",
            },
            {
                "name": "[KRISO] 파력고도화 연구",
                "subtitle": "방파제 연계형 파력발전 상용보급을 위한 성능 고도화",
                "type": "연구", "period": "26.01.01~26.12.31", "po": "이상재", "pm": "권순환",
                "prog": {"plan": 72, "actual": 100},
                "content": [
                    "[개발 단계]",
                    {"t": "1. 브릿지 서버 백엔드(JAVA) 개발", "sub": [
                        "semantic/physical 이중 식별 설계 반영",
                        "초 당 1,000건 이상의 Sample 데이터 테스트",
                        "100개 레지스터 값을 초 당 10번 조회",
                        "1분 기준 60,000개 Sample 처리 확인",
                    ]},
                ],
                "note": "권순환(1D)",
            },
            {
                "name": "[기타업무]", "type": "기타",
                "content": [
                    {"t": "1. 지엠티 스마트시트 버그 수정 및 사용성 개선 (김길용 1D)", "sub": [
                        "프로젝트 등록 15건, 회원가입 64명, 버그/의견 리포트 건수 2건",
                    ]},
                    "2. 항해항만학회 및 위성항법 워크숍 참석: 5/27~29 (운영기술개발실 8명 2D)",
                    "3. S-100 웹뷰어 프로토타입 개발 (김길용 1.5D)",
                ],
            },
        ],
        "nextWeek": [
            "[외근/출장] 수(6/3) 전원 휴일 · 박서준 휴가(6/1 월~6/2 화)",
            {"t": "[사업수행] [KRISO] 위성항법 연구", "sub": [
                "3차 내부 검토 회의 Action Item에 따른 설계서 산출물 보완 (기한: 6/4)",
            ]},
            {"t": "[연구과제] [LS전선] AI팩토리 연구", "sub": [
                "군산공장 웹 프로토타입 고도화 (md 파일 동적 연동)",
                "군산공장 플랜트 시뮬레이션 프로토타입 고도화",
                "C-레벨 시연 피드백 검토 회의 및 PoC 보완",
            ]},
            {"t": "[연구과제] [KRISO] 파력고도화 연구", "sub": [
                "브릿지 서버 백엔드 개발 (USD 모듈 개발 및 테스트)",
                "gRPC를 통한 장비/블럭 API 테스트",
            ]},
            {"t": "[연구과제] [내부] ECDIS 개발 및 인증", "sub": [
                "IEC-62288 수정된 시험절차로 테스트 진행",
                "메시지 시뮬레이터 구현",
                "S-64 시험결과 및 RIMS 문의 사항 제출",
            ]},
            {"t": "[기타]", "sub": [
                "지엠티 스마트시트 사용성 개선",
                "S-100 웹뷰어 개발",
            ]},
        ],
    },
]


def para_text(p):
    parts = []
    for node in p.iter():
        t = node.tag
        if t == W + 't':
            parts.append(node.text or '')
        elif t == W + 'tab':
            parts.append(' ')
        elif t in (W + 'br', W + 'cr'):
            parts.append('\n')
    return ''.join(parts).replace('\xa0', ' ')


def parse_blocks():
    root = ET.fromstring(zipfile.ZipFile(DOCX).read('word/document.xml'))
    body = root.find(W + 'body')
    blocks = []
    for child in list(body):
        if child.tag == W + 'p':
            blocks.append({'type': 'p', 'text': para_text(child).rstrip()})
        elif child.tag == W + 'tbl':
            rows = []
            for tr in child.findall(W + 'tr'):
                row = []
                for tc in tr.findall(W + 'tc'):
                    cell = [x.rstrip() for x in (para_text(p) for p in tc.findall(W + 'p'))]
                    cell = [c for c in cell if c.strip() != '']
                    row.append(cell)
                rows.append(row)
            blocks.append({'type': 'tbl', 'rows': rows})
    return blocks


# ── 텍스트 헬퍼 ──
def collapse(s):
    return re.sub(r'\s+', ' ', (s or '').replace('\n', ' ')).strip()


def cell_scalar(cell):
    return collapse(' '.join(cell))


def is_blank_scalar(s):
    s = (s or '').strip()
    return s == '' or s == '-' or s == '.' or s == '미정' or s == 'N/A'


def num_pct(s):
    m = re.search(r'(\d+(?:\.\d+)?)\s*%', s or '')
    return float(m.group(1)) if m else None


TOP_MARK = re.compile(r'^\s*([○■▶●◦□▣◆☞*]|\d+[\.\)]|[가-힣][\.\)]|\[[^\]]+\]|=>)')
SUB_MARK = re.compile(r'^\s*(-+|>+|→|·|ㆍ|∙|:|\d+\))')
LEAD_MARK = re.compile(r'^[\s○■▶●◦□▣◆☞*\-→>·ㆍ∙:]+')


def clean_line(s):
    return LEAD_MARK.sub('', s).strip()


def split_lines(paras):
    out = []
    for raw in paras:
        for ln in (raw or '').split('\n'):
            ln = ln.strip()
            if ln:
                out.append(ln)
    return out


def parse_content(paras):
    """문단 배열 -> content[] (문자열 또는 {t, sub:[]}). 모든 줄 보존(누락 0)."""
    out = []
    cur = None

    def flush():
        nonlocal cur
        if cur is None:
            return
        if cur.get('sub'):
            out.append({'t': cur['t'], 'sub': cur['sub']})
        else:
            out.append(cur['t'])
        cur = None

    for ln in split_lines(paras):
        if SUB_MARK.match(ln) and cur is not None:
            cur.setdefault('sub', []).append(clean_line(ln))
        else:
            flush()
            cur = {'t': clean_line(ln) if (TOP_MARK.match(ln) or LEAD_MARK.match(ln)) else ln}
    flush()
    return [x for x in out if (isinstance(x, dict) or x.strip())]


def parse_bullets_flat(paras):
    """차주계획 등: 단순 문자열 배열."""
    return [clean_line(ln) for ln in split_lines(paras) if clean_line(ln)]


# ── 헤더 분류 ──
def join_headers(row):
    return [cell_scalar(c) for c in row]


def find_idx(headers, *keys):
    for i, h in enumerate(headers):
        for k in keys:
            if k in h:
                return i
    return None


def classify(headers):
    hs = headers
    # 영업(수주확률/사업유형/발주처)은 '프로젝트명'을 포함해도 sales로 우선 판정
    if any('수주확률' in h for h in hs) or any('사업유형' in h for h in hs):
        return 'sales'
    if any('발주처' in h for h in hs) and any('프로젝트' in h for h in hs):
        return 'sales'
    if any('과제명' in h for h in hs):
        return 'research'
    if any('프로젝트명' in h for h in hs):
        return 'projects'
    if (find_idx(hs, '구분', '조직명') is not None and find_idx(hs, '내용') is not None
            and find_idx(hs, '시작') is not None):
        return 'strategy'
    if (find_idx(hs, '제목', '사업명', '이슈') is not None
            and find_idx(hs, '조치', '방안', '내용') is not None):
        return 'issues'
    return None


SECTION_TITLE = [
    (re.compile(r'전략\s*회의'), 'strategy'),
    (re.compile(r'이슈'), 'issues'),
    (re.compile(r'영업|기획'), 'sales'),
    (re.compile(r'연구|과제'), 'research'),
    (re.compile(r'수행|업무\s*보고|주간\s*보고|주간보고'), 'projects'),
]


def section_hint(text):
    t = collapse(text)
    if len(t) > 30:
        return None
    if not re.match(r'^\s*(\d+\s*[\.\)]|[가-힣]\s*[\.\)])?\s*', t):
        return None
    for rx, sec in SECTION_TITLE:
        if rx.search(t):
            return sec
    return None


def row_nonempty(row):
    return [c for c in row if cell_scalar(c)]


# ── 데이터 행 -> 섹션 항목 ──
def build_prog(row, cm):
    plan_s = cell_scalar(row[cm['plan']]) if cm.get('plan') is not None and cm['plan'] < len(row) else ''
    act_s = cell_scalar(row[cm['actual']]) if cm.get('actual') is not None and cm['actual'] < len(row) else ''
    comb_s = cell_scalar(row[cm['prog']]) if cm.get('prog') is not None and cm['prog'] < len(row) else ''
    plan = num_pct(plan_s)
    actual = num_pct(act_s)
    if comb_s:
        nums = re.findall(r'(\d+(?:\.\d+)?)\s*%', comb_s)
        if len(nums) >= 2:
            plan = plan if plan is not None else float(nums[0])
            actual = actual if actual is not None else float(nums[1])
        elif len(nums) == 1 and actual is None:
            actual = float(nums[0])
    res = {}
    if plan is not None:
        res['plan'] = plan
    if actual is not None:
        res['actual'] = actual
    if res:
        return res
    for s in (comb_s, act_s, plan_s):
        if not is_blank_scalar(s):
            return {'text': collapse(s)}
    return None


def get(row, cm, key):
    i = cm.get(key)
    if i is None or i >= len(row):
        return ''
    return cell_scalar(row[i])


def get_content(row, cm, key):
    i = cm.get(key)
    if i is None or i >= len(row):
        return []
    return parse_content(row[i])


def colmap_projects(hs):
    return {
        'name': find_idx(hs, '프로젝트명'),
        'type': find_idx(hs, '구분', '사업유형', '사업 구분'),
        'period': find_idx(hs, '사업기간', '사업 기간', '기간'),
        'po': find_idx(hs, 'PO'),
        'pm': find_idx(hs, '사업PM', 'PM(PL)', 'PM'),
        'pl': find_idx(hs, '개발PL', 'PL'),
        'ba': find_idx(hs, 'BA'),
        'plan': find_idx(hs, '계획율', '목표율'),
        'actual': _actual_idx(hs),
        'prog': _combined_prog_idx(hs),
        'content': find_idx(hs, '업무 내용', '업무내용', '진행사항', '내 용', '내용', '사업관리 및 영업'),
        'note': find_idx(hs, '비고', '비 고'),
        'issue': find_idx(hs, '이슈/향후', '이슈/사항', '이슈 사항', '이슈사항', '향후'),
        'effort': find_idx(hs, '투입'),
    }


def _actual_idx(hs):
    # 단독 진척/달성 컬럼 (계획/실적 결합 헤더 제외)
    for i, h in enumerate(hs):
        if ('계획' in h and '실적' in h) or '금주/누적' in h:
            continue
        if any(k in h for k in ('진척율', '진척률', '달성율', '진행율', '진핸율', '진 척 율')):
            return i
    return None


def _combined_prog_idx(hs):
    for i, h in enumerate(hs):
        if ('계획' in h and '실적' in h) or '금주/누적' in h or '계획/실적' in h:
            return i
    return None


def colmap_issues(hs):
    plan = find_idx(hs, '조치 계획', '조치계획/결과', '조치계획', '방안', '계획')
    result = find_idx(hs, '조치 결과', '조치결과')
    if result is not None and result == plan:
        result = None  # '조치계획/결과' 통합 컬럼이 양쪽에 잡히는 중복 방지
    return {
        'title': find_idx(hs, '이슈 제목', '제목(사업명)', '사업명', '제목'),
        'icontent': find_idx(hs, '이슈 내용', '이슈/현안', '내용'),
        'plan': plan,
        'result': result,
        'note': find_idx(hs, '비고', '비 고'),
    }


def colmap_strategy(hs):
    return {
        'div': find_idx(hs, '조직명', '구분'),
        'content': find_idx(hs, '내용', '내    용', '내 용'),
        'start': find_idx(hs, '시작'),
        'plan': find_idx(hs, '계획'),
        'end': find_idx(hs, '종료', '완료'),
        'action': find_idx(hs, '조치 계획 및 결과', '조치계획 및 결과', '조치'),
        'status': find_idx(hs, '상태'),
    }


def colmap_research(hs):
    return {
        'name': find_idx(hs, '과제명'),
        'org': find_idx(hs, '전문기관', '주관기관'),
        'period': find_idx(hs, '기간'),
        'lead': find_idx(hs, '연구', '책임자'),
        'fund': find_idx(hs, '정부출연금', '출연금'),
        'exec': find_idx(hs, '집행률'),
        'content': find_idx(hs, '진행사항', '내용'),
    }


def colmap_sales(hs):
    return {
        'div': find_idx(hs, '구분'),
        'client': find_idx(hs, '발주처'),
        'project': find_idx(hs, '프로젝트명', '프로젝트', '제목', '사업명'),
        'type': find_idx(hs, '사업유형'),
        'amount': find_idx(hs, '금액', '사업예산'),
        'when': find_idx(hs, '시기', '사업기간', '기간'),
        'stage': find_idx(hs, '단계', '입찰 구분', '사업구분'),
        'rate': _actual_idx(hs) if _actual_idx(hs) is not None else None,
        'prob': find_idx(hs, '수주확률'),
        'content': find_idx(hs, '업무내용', '업무 내용', '사업관리 및 영업', '주요 내용', '진행 현황', '내용'),
        'actionresult': find_idx(hs, '조치계획/결과', '조치계획', '조치'),
        'note': find_idx(hs, '비고'),
    }


def add_project(sec, row, cm):
    name = get(row, cm, 'name')
    if not name:
        return
    p = {'name': name}
    typ = get(row, cm, 'type')
    if typ:
        p['type'] = typ
    period = get(row, cm, 'period')
    if period:
        p['period'] = period
    for k in ('po', 'pm', 'pl', 'ba'):
        v = get(row, cm, k)
        if v and not is_blank_scalar(v):
            p[k] = v
    prog = build_prog(row, cm)
    if prog:
        p['prog'] = prog
    content = get_content(row, cm, 'content')
    if content:
        p['content'] = content
    note_bits = []
    nv = get(row, cm, 'note')
    if nv and not is_blank_scalar(nv):
        note_bits.append(nv)
    ev = get(row, cm, 'effort')
    if ev and not is_blank_scalar(ev):
        note_bits.append(f"투입 {ev}")
    if note_bits:
        p['note'] = ' · '.join(note_bits)
    iv = get(row, cm, 'issue')
    if iv and not is_blank_scalar(iv):
        p['issue'] = iv
    sec.append(p)


def add_issue(sec, row, cm):
    title = get(row, cm, 'title')
    body = get_content(row, cm, 'icontent')
    if not title and not body:
        return
    it = {'title': title or '(제목 없음)'}
    if body:
        it['content'] = body
    plan = get_content(row, cm, 'plan')
    if plan:
        it['plan'] = plan
    result = get_content(row, cm, 'result')
    if result:
        it['result'] = result
    nv = get(row, cm, 'note')
    if nv and not is_blank_scalar(nv):
        it['note'] = nv
    sec.append(it)


def add_strategy(sec, row, cm):
    div = get(row, cm, 'div')
    content = get_content(row, cm, 'content')
    action = get_content(row, cm, 'action')
    if not (content or action):
        return
    st = {'div': div or '-'}
    if content:
        st['content'] = content
    for k in ('start', 'plan', 'end'):
        v = get(row, cm, k)
        if v and not is_blank_scalar(v):
            st[k] = v
    if action:
        st['action'] = action
    status = get(row, cm, 'status')
    if status and not is_blank_scalar(status):
        st['status'] = status
    sec.append(st)


def add_research(sec, row, cm):
    name = get(row, cm, 'name')
    if not name:
        return
    r = {'name': name}
    for k in ('org', 'period', 'lead', 'fund'):
        v = get(row, cm, k)
        if v and not is_blank_scalar(v):
            r[k] = v
    ex = get(row, cm, 'exec')
    en = num_pct(ex)
    if en is not None:
        r['exec'] = en
    content = get_content(row, cm, 'content')
    if content:
        r['content'] = content
    sec.append(r)


def add_sales(sec, row, cm):
    project = get(row, cm, 'project')
    client = get(row, cm, 'client')
    if not (project or client):
        return
    s = {}
    if get(row, cm, 'div'):
        s['div'] = get(row, cm, 'div')
    if client and not is_blank_scalar(client):
        s['client'] = client
    s['project'] = project or '-'
    for k in ('amount', 'when', 'stage'):
        v = get(row, cm, k)
        if v and not is_blank_scalar(v):
            s[k] = v
    rate = num_pct(get(row, cm, 'rate'))
    if rate is not None:
        s['rate'] = rate
    else:
        rt = get(row, cm, 'prob') or get(row, cm, 'rate')
        if rt and not is_blank_scalar(rt):
            s['rateText'] = rt
    content = get_content(row, cm, 'content')
    ar = get_content(row, cm, 'actionresult')
    if ar:
        content = (content or []) + ar
    if content:
        s['content'] = content
    nv = get(row, cm, 'note')
    if nv and not is_blank_scalar(nv):
        s['note'] = nv
    sec.append(s)


def is_label_row(row):
    """[차주...]/[기타...]/[공통...]/[개인...] 단일 라벨 행 → (kind, paras)"""
    ne = row_nonempty(row)
    if not ne:
        return None
    first = cell_scalar(ne[0])
    m = re.match(r'^\s*\[\s*(차주|기타|공통|개인|차주 출장)', first)
    if not m:
        return None
    # 모든 비어있지 않은 셀의 문단을 합쳐 라벨/내용 보존
    paras = []
    for c in ne:
        paras.extend(c)
    return (m.group(1), paras)


def build_report(blocks, lo, hi):
    """lo < block index < hi 범위의 (문단 섹션 힌트 + 표 행)을 순서대로 훑어 섹션 구성."""
    sections = {'strategy': [], 'issues': [], 'projects': [], 'sales': [], 'research': [], 'nextWeek': []}
    hint = None
    cur_sec = None
    cm = None
    for idx in range(lo + 1, hi):
        b = blocks[idx]
        if b['type'] == 'p':
            h = section_hint(b['text'])
            if h:
                hint = h
            continue
        # table: walk rows
        for row in b['rows']:
            ne = row_nonempty(row)
            if not ne:
                continue
            # 차주/기타/공통 라벨 행
            lab = is_label_row(row)
            if lab:
                kind, paras = lab
                if kind.startswith('차주'):
                    bl = [x for x in parse_bullets_flat(paras) if not re.match(r'^\[?\s*차주', x)]
                    sections['nextWeek'].extend(bl)
                else:
                    # 기타/공통/개인 → projects 행으로(내용만)
                    label = clean_line(cell_scalar(ne[0]).split('/')[0])
                    sections['projects'].append({'name': label or '[기타 업무]', 'type': '기타',
                                                  'content': parse_content(paras[1:] if len(paras) > 1 else paras)})
                continue
            headers = join_headers(row)
            sec = classify(headers)
            # 섹션 제목만 있는 행(나머지 빈칸)
            only_title = len(ne) == 1 and section_hint(cell_scalar(ne[0]))
            if only_title:
                hint = section_hint(cell_scalar(ne[0]))
                continue
            if sec:
                # 헤더 행: 컬럼맵 설정, 힌트로 sales/issues 보정
                cur_sec = sec
                if hint == 'sales' and sec in ('issues', 'projects'):
                    cur_sec = 'sales'
                if cur_sec == 'projects':
                    cm = colmap_projects(headers)
                elif cur_sec == 'issues':
                    cm = colmap_issues(headers)
                elif cur_sec == 'strategy':
                    cm = colmap_strategy(headers)
                elif cur_sec == 'research':
                    cm = colmap_research(headers)
                elif cur_sec == 'sales':
                    cm = colmap_sales(headers)
                continue
            # 데이터 행
            if cur_sec is None or cm is None:
                # 헤더 못 찾음: 힌트 기반 최소 처리(내용 보존)
                if hint == 'strategy':
                    cur_sec, cm = 'strategy', {'div': 0, 'content': 1, 'start': 2, 'plan': 3, 'end': 4, 'action': 5, 'status': 6}
                else:
                    # projects 폴백: 첫 셀=name, 마지막 큰 셀=content
                    paras = []
                    for c in ne[1:]:
                        paras.extend(c)
                    sections['projects'].append({'name': cell_scalar(ne[0]),
                                                  'content': parse_content(paras) if paras else []})
                    continue
            if cur_sec == 'projects':
                nm = get(row, cm, 'name')
                if not nm:
                    # 이름 빈 이어지는 행 → 직전 프로젝트에 내용 병합(누락 방지)
                    extra = get_content(row, cm, 'content')
                    if not extra:
                        # content 컬럼 밖에 내용이 있을 수 있어 비어있지 않은 셀 전체 병합
                        paras = []
                        for c in ne:
                            paras.extend(c)
                        extra = parse_content(paras)
                    if extra and sections['projects']:
                        sections['projects'][-1].setdefault('content', [])
                        sections['projects'][-1]['content'].extend(extra)
                    continue
                add_project(sections['projects'], row, cm)
            elif cur_sec == 'issues':
                add_issue(sections['issues'], row, cm)
            elif cur_sec == 'strategy':
                add_strategy(sections['strategy'], row, cm)
            elif cur_sec == 'research':
                add_research(sections['research'], row, cm)
            elif cur_sec == 'sales':
                proj = get(row, cm, 'project')
                cli = get(row, cm, 'client')
                if not (proj or cli):
                    extra = get_content(row, cm, 'content') + get_content(row, cm, 'actionresult')
                    if extra and sections['sales']:
                        sections['sales'][-1].setdefault('content', [])
                        sections['sales'][-1]['content'].extend(extra)
                    continue
                add_sales(sections['sales'], row, cm)
    cleanup(sections)
    return {k: v for k, v in sections.items() if v}


def cleanup(sections):
    """라벨만 있고 실내용이 없는 빈 항목 제거(누락 아님 — 의미 없는 껍데기 제거)."""
    def has(d, *keys):
        return any(d.get(k) for k in keys)
    sections['projects'] = [p for p in sections['projects']
                            if has(p, 'content', 'prog', 'period', 'pm', 'po', 'pl', 'issue')]
    sections['sales'] = [s for s in sections['sales']
                         if has(s, 'content', 'amount', 'rate', 'rateText', 'stage', 'when', 'client')]
    sections['issues'] = [i for i in sections['issues']
                          if has(i, 'content', 'plan', 'result')]


def build_reports():
    blocks = parse_blocks()
    ends = sorted(o['wordEnd'] for o in ORGS)
    out = []
    for o in ORGS:
        E = o['wordEnd']
        lo = max([e for e in ends if e < E], default=-1)
        secs = build_report(blocks, lo, E)
        rep = {'id': o['id'], 'group': o['group'], 'icon': o['icon'], 'org': o['org'],
               'reporter': o['reporter'], 'recipient': o['recipient']}
        rep.update(secs)
        out.append(rep)
    out.extend(MANUAL_REPORTS)
    return out


def summary():
    reps = build_reports()
    for r in reps:
        counts = {k: len(r.get(k, [])) for k in ('strategy', 'issues', 'projects', 'sales', 'research', 'nextWeek')}
        print(f"{r['org'][:22]:24} S{counts['strategy']} I{counts['issues']} P{counts['projects']} "
              f"Sa{counts['sales']} R{counts['research']} N{counts['nextWeek']}")


def gen():
    reps = build_reports()
    js = json.dumps(reps, ensure_ascii=False, indent=1)
    with open(HTML, 'r', encoding='utf-8') as f:
        html = f.read()
    start = '/* @@REPORTS_START@@ */'
    end = '/* @@REPORTS_END@@ */'
    if start not in html or end not in html:
        raise SystemExit('센티넬(@@REPORTS_START@@/@@REPORTS_END@@)이 weeklyReport.html에 없습니다. 먼저 추가하세요.')
    pre = html[:html.index(start) + len(start)]
    post = html[html.index(end):]
    new = pre + '\nconst REPORTS = ' + js + ';\n' + post
    with open(HTML, 'w', encoding='utf-8') as f:
        f.write(new)
    print(f"injected REPORTS: {len(reps)} orgs, {len(js)} chars")


def diag():
    blocks = parse_blocks()
    print(f"== total blocks: {len(blocks)} ==")
    for i, b in enumerate(blocks):
        if b['type'] == 'p':
            txt = collapse(b['text'])
            if txt and (re.match(r'^\s*[가-힣]{2,4}\s*(드림|올림|배상|드립니다)', txt) or len(txt) < 60):
                print(f"P[{i:3}] {txt[:70]}")
        else:
            rows = b['rows']
            hdr = ' | '.join(cell_scalar(c) for c in rows[0]) if rows else ''
            print(f"T[{i:3}] rows={len(rows):2} hdr= {hdr[:110]}")


def dump():
    target = sys.argv[2] if len(sys.argv) > 2 else 'r-techdev'
    reps = build_reports()
    for r in reps:
        if r['id'] == target:
            print(json.dumps(r, ensure_ascii=False, indent=1))
            return
    print('not found:', target)


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'summary'
    {'diag': diag, 'gen': gen, 'summary': summary, 'dump': dump}.get(mode, summary)()
