-- 조직 트리 + 인원 시드 데이터 (정적 JSON 이관)
-- 멱등성: org_nodes는 ON CONFLICT(id) DO UPDATE, org_members는 (name, department) 유니크 제약이 없어
--          기존 데이터를 모두 비우고 다시 INSERT 한다. 운영 환경에서 사용자 편집을 보존하려면 이 시드를 재실행하지 말 것.

BEGIN;

-- org_nodes ─────────────────────────────────────────────────────────
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('gmt', '(주)지엠티', NULL, ARRAY[]::text[], 0) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('gmt-root', '지엠티', 'gmt', ARRAY[]::text[], 0) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('ceo', 'CEO', 'gmt-root', ARRAY['CEO']::text[], 0) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('mgmt-strategy', '경영전략본부', 'gmt-root', ARRAY[]::text[], 1) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('mgmt-support', '경영지원팀', 'mgmt-strategy', ARRAY['경영지원팀']::text[], 0) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('purchasing', '구매팀', 'mgmt-strategy', ARRAY['구매팀']::text[], 1) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('rnd-support', 'R&D지원팀', 'mgmt-strategy', ARRAY['R&D지원팀']::text[], 2) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('sales-public', '영업대표 - 공공사업', 'gmt-root', ARRAY['영업대표 - 공공부문']::text[], 2) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('sales-strategic', '영업대표 - 전략사업', 'gmt-root', ARRAY['영업대표 - 전략사업']::text[], 3) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('ai-lab', 'AI개발실', 'gmt-root', ARRAY['AI개발실']::text[], 4) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('advisor', '자문위원', 'gmt-root', ARRAY['자문위원']::text[], 5) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('op-tech', '운영기술개발실', 'gmt-root', ARRAY['운영기술개발실']::text[], 6) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('strategy-plan', '전략기획실', 'gmt-root', ARRAY['전략기획실']::text[], 7) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('energy', '에너지 사업부', 'gmt-root', ARRAY['에너지사업부']::text[], 8) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('mobility-dev', '모빌리티개발팀', 'gmt-root', ARRAY['모빌리티개발팀']::text[], 9) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('mobility-biz', '모빌리티사업부', 'gmt-root', ARRAY['모빌리티사업부']::text[], 10) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('mobility-1', '모빌리티사업1팀', 'mobility-biz', ARRAY['모빌리티사업1팀']::text[], 0) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('mobility-2', '모빌리티사업2팀', 'mobility-biz', ARRAY['모빌리티사업2팀']::text[], 1) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('navcomm', '항해통신 사업부', 'gmt-root', ARRAY['항해통신사업부']::text[], 11) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('navcomm-1', '항해통신 사업1팀', 'navcomm', ARRAY['항해통신사업1팀']::text[], 0) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('navcomm-2', '항해통신 사업2팀', 'navcomm', ARRAY['항해통신사업2팀']::text[], 1) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('navctrl', '항행관제 사업부', 'gmt-root', ARRAY['항행관제사업부']::text[], 12) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('navctrl-1', '항행관제 사업1팀', 'navctrl', ARRAY['항행관제사업1팀']::text[], 0) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('navctrl-2', '항행관제 사업2팀', 'navctrl', ARRAY['항행관제사업2팀']::text[], 1) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('solution', '솔루션 사업부', 'gmt-root', ARRAY['솔루션사업부']::text[], 13) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('ict', 'ICT 사업부', 'gmt-root', ARRAY['ICT사업부']::text[], 14) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('sm', 'SM 사업팀', 'ict', ARRAY['SM사업팀']::text[], 0) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('si', 'SI 사업팀', 'ict', ARRAY['SI사업팀']::text[], 1) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('smart-marine', '지능형해상교통사업부', 'gmt-root', ARRAY['지능형해상교통사업부']::text[], 15) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('biz-plan', '사업기획팀', 'smart-marine', ARRAY['사업기획팀']::text[], 0) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('biz-exec', '사업수행팀', 'smart-marine', ARRAY['사업수행팀']::text[], 1) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('tech-dev', '기술 개발본부', 'gmt-root', ARRAY['기술개발본부']::text[], 16) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('vision', '비전개발센터', 'tech-dev', ARRAY['비전개발센터']::text[], 0) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('platform', '플랫폼개발센터', 'tech-dev', ARRAY['플랫폼개발센터']::text[], 1) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('app-tech', '응용기술 개발센터', 'tech-dev', ARRAY['응용기술개발센터']::text[], 2) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('app-dev-1', '응용 개발1팀', 'app-tech', ARRAY['응용개발1팀']::text[], 0) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;
INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ('app-dev-2', '응용 개발2팀', 'app-tech', ARRAY['응용개발2팀']::text[], 1) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;

-- org_members ──────────────────────────────────────────────────────
DELETE FROM org_members;
INSERT INTO org_members (name, department, position, gender, sort_order) VALUES
('김현', '기술개발본부', '이사', '남자', 0),
('김민엽', 'ICT사업부', '상무', '남자', 1),
('신희용', '솔루션사업부', '책임', '남자', 2),
('이상재', '운영기술개발실', '상무', '남자', 3),
('박성규', '응용기술개발센터', '수석', '남자', 4),
('고석영', 'SM사업팀', '책임', '남자', 5),
('양승훈', '솔루션사업부', '책임', '남자', 6),
('김길용', '운영기술개발실', '수석', '남자', 7),
('신동훈', '응용개발1팀', '수석', '남자', 8),
('하재철', 'SM사업팀', '전임', '남자', 9),
('김요셉', '솔루션사업부', '책임', '남자', 10),
('권순환', '운영기술개발실', '전임', '남자', 11),
('이훈휘', '응용개발1팀', '책임', '남자', 12),
('이준영', 'SM사업팀', '전임', '남자', 13),
('마상권', '솔루션사업부', '책임', '남자', 14),
('김홍태', '운영기술개발실', '연구원', '남자', 15),
('오헌경', '응용개발1팀', '책임', '남자', 16),
('황상윤', 'SM사업팀', '전임', '남자', 17),
('김완호', '솔루션사업부', '선임', '남자', 18),
('최우혁', '운영기술개발실', '연구원', '남자', 19),
('안준혁', '응용개발1팀', '선임', '남자', 20),
('서정인', 'SM사업팀', '전임', '남자', 21),
('오재권', '솔루션사업부', '선임', '남자', 22),
('김경환', '운영기술개발실', '연구원', '남자', 23),
('이예섭', '응용개발1팀', '전임', '남자', 24),
('최경규', 'SM사업팀', '연구원', '남자', 25),
('배성희', '솔루션사업부', '전임', '여자', 26),
('박서준', '운영기술개발실', '연구원', '남자', 27),
('신원지', '응용개발1팀', '연구원', '여자', 28),
('김세영', 'SM사업팀', '연구원', '여자', 29),
('정현석', '솔루션사업부', '전임', '남자', 30),
('정회성', '운영기술개발실', '연구원', '남자', 31),
('이재훈', '응용개발2팀', '책임', '남자', 32),
('조영은', 'SM사업팀', '연구원', '여자', 33),
('김대영', '솔루션사업부', '연구원', '남자', 34),
('문병욱', 'CEO', '대표이사', '남자', 35),
('김지산', '응용개발2팀', '책임', '남자', 36),
('허유나', 'SM사업팀', '연구원', '여자', 37),
('박현수', '솔루션사업부', '연구원', '남자', 38),
('임우철', '경영지원팀', '수석', '남자', 39),
('복은서', '응용개발2팀', '전임', '여자', 40),
('이경준', 'SM사업팀', '연구원', '남자', 41),
('이수정', '솔루션사업부', '연구원', '여자', 42),
('장은영', '경영지원팀', '책임', '여자', 43),
('이자영', '응용개발2팀', '연구원', '여자', 44),
('박정훈', 'SI사업팀', '수석', '남자', 45),
('정태창', '솔루션사업부', '이사', '남자', 46),
('김민성', '경영지원팀', '선임', '남자', 47),
('이현민', '응용개발2팀', '연구원', '남자', 48),
('양이레', 'SI사업팀', '책임', '여자', 49),
('한규혁', '항해통신사업부', '수석', '남자', 50),
('이경진', '경영지원팀', '선임', '여자', 51),
('이슬', '응용개발2팀', '연구원', '여자', 52),
('배석', 'SI사업팀', '책임', '남자', 53),
('황준호', '항해통신사업1팀', '수석', '남자', 54),
('이혜진', '경영지원팀', '전임', '여자', 55),
('정민환', '비전개발센터', '수석', '남자', 56),
('장민규', 'SI사업팀', '선임', '남자', 57),
('신진우', '항해통신사업1팀', '선임', '남자', 58),
('허단비', '경영지원팀', '전임', '여자', 59),
('이상길', '비전개발센터', '수석', '남자', 60),
('김선화', 'SI사업팀', '전임', '여자', 61),
('노재원', '항해통신사업1팀', '전임', '남자', 62),
('지경민', '구매팀', '책임', '남자', 63),
('유병규', '비전개발센터', '책임', '남자', 64),
('전인호A', 'SI사업팀', '전임', '남자', 65),
('이준혁', '항해통신사업1팀', '전임', '남자', 66),
('김은정', 'R&D지원팀', '선임', '여자', 67),
('박성웅', '비전개발센터', '책임', '남자', 68),
('전인호', 'SI사업팀', '이사', '남자', 69),
('김주영', '항해통신사업1팀', '전임', '남자', 70),
('조아라', 'R&D지원팀', '전임', '여자', 71),
('문성준', '비전개발센터', '선임', '남자', 72),
('김태식', '지능형해상교통사업부', '상무', '남자', 73),
('박상일', '항해통신사업2팀', '수석', '남자', 74),
('신현빈', '모빌리티사업부', '수석', '남자', 75),
('최윤석', '비전개발센터', '선임', '남자', 76),
('김영실', '사업기획팀', '선임', '여자', 77),
('이의용', '항해통신사업2팀', '수석', '남자', 78),
('한영석', '모빌리티사업1팀', '수석', '남자', 79),
('임서율', '비전개발센터', '선임', '여자', 80),
('허지원', '사업기획팀', '전임', '여자', 81),
('강동석', '항해통신사업2팀', '수석', '남자', 82),
('은준우', '모빌리티사업1팀', '선임', '남자', 83),
('권준영', '비전개발센터', '전임', '남자', 84),
('이동규', '사업수행팀', '책임', '남자', 85),
('이신용', '항해통신사업2팀', '수석', '남자', 86),
('이수빈', '모빌리티사업1팀', '사원', '여자', 87),
('이승하', '비전개발센터', '전임', '여자', 88),
('문성대', '사업수행팀', '책임', '남자', 89),
('송유신', '항해통신사업2팀', '수석', '남자', 90),
('정기현', '모빌리티사업2팀', '수석', '남자', 91),
('김재현', '비전개발센터', '전임', '남자', 92),
('정성윤', '사업수행팀', '선임', '남자', 93),
('이강호', '항해통신사업2팀', '책임', '남자', 94),
('송우진', '모빌리티사업2팀', '책임', '남자', 95),
('성유경', '비전개발센터', '전임', '여자', 96),
('남우준', '사업수행팀', '전임', '남자', 97),
('이기석', '항해통신사업2팀', '선임', '남자', 98),
('하정효', '모빌리티사업2팀', '책임', '남자', 99),
('박은성', '비전개발센터', '연구원', '남자', 100),
('문준석', '사업수행팀', '전임', '남자', 101),
('고병용', '항해통신사업2팀', '전임', '남자', 102),
('김완재', '모빌리티사업2팀', '선임', '남자', 103),
('이남규', '비전개발센터', '연구원', '남자', 104),
('구현수', '사업수행팀', '전임', '남자', 105),
('박형호', '항해통신사업2팀', '전임', '남자', 106),
('김다운', '모빌리티사업2팀', '연구원', '여자', 107),
('신현호', '비전개발센터', '연구원', '남자', 108),
('최성복', '사업수행팀', '연구원', '남자', 109),
('김도훈', '항해통신사업2팀', '전임', '남자', 110),
('김영심', '모빌리티사업2팀', '사원', '여자', 111),
('정윤수', '비전개발센터', '연구원', '남자', 112),
('이지우', '사업수행팀', '연구원', '남자', 113),
('박관웅', '항해통신사업2팀', '연구원', '남자', 114),
('하재술', '자문위원', '고문', '남자', 115),
('박준호', '플랫폼개발센터', '수석', '남자', 116),
('조유민', '사업수행팀', '연구원', '남자', 117),
('서원택', 'AI개발실', '상무', '남자', 118),
('이권우', '영업대표 - 전략사업', '전무', '남자', 119),
('박수영', '플랫폼개발센터', '수석', '남자', 120),
('홍영호', '사업수행팀', '연구원', '남자', 121),
('심지우', 'AI개발실', '선임', '여자', 122),
('박진우', '영업대표 - 전략사업', '연구원', '남자', 123),
('김동균', '플랫폼개발센터', '책임', '남자', 124),
('윤성우', 'AI개발실', '전임', '남자', 125),
('김창민', '영업대표 - 공공부문', '상무', '남자', 126),
('김현철', '플랫폼개발센터', '책임', '남자', 127),
('정주은', 'AI개발실', '전임', '여자', 128),
('박상규', '영업대표 - 공공부문', '수석', '남자', 129),
('최재환', '플랫폼개발센터', '책임', '남자', 130),
('권혜정', 'AI개발실', '전임', '여자', 131),
('남정찬', '영업대표 - 공공부문', '전임', '남자', 132),
('박종화', '플랫폼개발센터', '전임', '남자', 133),
('이지호', 'AI개발실', '연구원', '남자', 134),
('주현석', '에너지사업부', '상무', '남자', 135),
('문병권', '플랫폼개발센터', '전임', '남자', 136),
('송용학', '항행관제사업부', '이사', '남자', 137),
('최재연', '에너지사업부', '수석', '남자', 138),
('이예은', '플랫폼개발센터', '연구원', '여자', 139),
('양승호', '항행관제사업부', '이사', '남자', 140),
('김태민', '에너지사업부', '책임', '남자', 141),
('최현정', '플랫폼개발센터', '연구원', '여자', 142),
('김현근', '항행관제사업1팀', '책임', '남자', 143),
('이선호', '에너지사업부', '전임', '남자', 144),
('양재훈', '모빌리티개발팀', '상무', '남자', 145),
('노수기', '항행관제사업1팀', '선임', '남자', 146),
('이덕수', '에너지사업부', '이사', '남자', 147),
('김희창', '모빌리티개발팀', '수석', '남자', 148),
('장호철', '항행관제사업1팀', '선임', '남자', 149),
('김영훈', '전략기획실', '수석', '남자', 150),
('이정호', '모빌리티개발팀', '수석', '남자', 151),
('김서현', '항행관제사업1팀', '연구원', '여자', 152),
('이섬결', '전략기획실', '책임', '여자', 153),
('이재욱', '모빌리티개발팀', '책임', '남자', 154),
('김일웅', '항행관제사업2팀', '수석', '남자', 155),
('양승원', '전략기획실', '선임', '여자', 156),
('김민균', '모빌리티개발팀', '전임', '남자', 157),
('오병희', '항행관제사업2팀', '선임', '남자', 158),
('지소휘', '전략기획실', '전임', '여자', 159),
('김선환', '모빌리티개발팀', '연구원', '남자', 160),
('윤태상', '항행관제사업2팀', '연구원', '남자', 161),
('심지열', '항행관제사업2팀', '연구원', '남자', 162),
('김다해', '항행관제사업2팀', '사원', '여자', 163);

COMMIT;
