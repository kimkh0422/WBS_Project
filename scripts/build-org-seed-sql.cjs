/* eslint-disable */
/**
 * src/data/organization.ts의 ORG_TREE + organizationMembers.json을 읽어
 * Supabase 시드 마이그레이션 SQL을 생성한다.
 *
 * 출력: supabase/migrations/20260430120001_seed_organization.sql
 */

const fs = require('fs');
const path = require('path');

// ─── 트리 정의 (organization.ts와 동기화) ────────────────────────────────────
const ORG_TREE = {
  id: 'gmt',
  name: '(주)지엠티',
  children: [
    {
      id: 'gmt-root',
      name: '지엠티',
      children: [
        { id: 'ceo', name: 'CEO', departments: ['CEO'] },
        {
          id: 'mgmt-strategy',
          name: '경영전략본부',
          children: [
            { id: 'mgmt-support', name: '경영지원팀', departments: ['경영지원팀'] },
            { id: 'purchasing', name: '구매팀', departments: ['구매팀'] },
            { id: 'rnd-support', name: 'R&D지원팀', departments: ['R&D지원팀'] },
          ],
        },
        { id: 'sales-public', name: '영업대표 - 공공사업', departments: ['영업대표 - 공공부문'] },
        { id: 'sales-strategic', name: '영업대표 - 전략사업', departments: ['영업대표 - 전략사업'] },
        { id: 'ai-lab', name: 'AI개발실', departments: ['AI개발실'] },
        { id: 'advisor', name: '자문위원', departments: ['자문위원'] },
        { id: 'op-tech', name: '운영기술개발실', departments: ['운영기술개발실'] },
        { id: 'strategy-plan', name: '전략기획실', departments: ['전략기획실'] },
        { id: 'energy', name: '에너지 사업부', departments: ['에너지사업부'] },
        { id: 'mobility-dev', name: '모빌리티개발팀', departments: ['모빌리티개발팀'] },
        {
          id: 'mobility-biz',
          name: '모빌리티사업부',
          departments: ['모빌리티사업부'],
          children: [
            { id: 'mobility-1', name: '모빌리티사업1팀', departments: ['모빌리티사업1팀'] },
            { id: 'mobility-2', name: '모빌리티사업2팀', departments: ['모빌리티사업2팀'] },
          ],
        },
        {
          id: 'navcomm',
          name: '항해통신 사업부',
          departments: ['항해통신사업부'],
          children: [
            { id: 'navcomm-1', name: '항해통신 사업1팀', departments: ['항해통신사업1팀'] },
            { id: 'navcomm-2', name: '항해통신 사업2팀', departments: ['항해통신사업2팀'] },
          ],
        },
        {
          id: 'navctrl',
          name: '항행관제 사업부',
          departments: ['항행관제사업부'],
          children: [
            { id: 'navctrl-1', name: '항행관제 사업1팀', departments: ['항행관제사업1팀'] },
            { id: 'navctrl-2', name: '항행관제 사업2팀', departments: ['항행관제사업2팀'] },
          ],
        },
        { id: 'solution', name: '솔루션 사업부', departments: ['솔루션사업부'] },
        {
          id: 'ict',
          name: 'ICT 사업부',
          departments: ['ICT사업부'],
          children: [
            { id: 'sm', name: 'SM 사업팀', departments: ['SM사업팀'] },
            { id: 'si', name: 'SI 사업팀', departments: ['SI사업팀'] },
          ],
        },
        {
          id: 'smart-marine',
          name: '지능형해상교통사업부',
          departments: ['지능형해상교통사업부'],
          children: [
            { id: 'biz-plan', name: '사업기획팀', departments: ['사업기획팀'] },
            { id: 'biz-exec', name: '사업수행팀', departments: ['사업수행팀'] },
          ],
        },
        {
          id: 'tech-dev',
          name: '기술 개발본부',
          departments: ['기술개발본부'],
          children: [
            { id: 'vision', name: '비전개발센터', departments: ['비전개발센터'] },
            { id: 'platform', name: '플랫폼개발센터', departments: ['플랫폼개발센터'] },
            {
              id: 'app-tech',
              name: '응용기술 개발센터',
              departments: ['응용기술개발센터'],
              children: [
                { id: 'app-dev-1', name: '응용 개발1팀', departments: ['응용개발1팀'] },
                { id: 'app-dev-2', name: '응용 개발2팀', departments: ['응용개발2팀'] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const esc = (s) => String(s == null ? '' : s).replace(/'/g, "''");

const flattenNodes = () => {
  const rows = [];
  const walk = (node, parentId, sortOrder) => {
    rows.push({
      id: node.id,
      name: node.name,
      parentId: parentId,
      departments: node.departments ?? [],
      sortOrder,
    });
    (node.children ?? []).forEach((child, idx) => walk(child, node.id, idx));
  };
  walk(ORG_TREE, null, 0);
  return rows;
};

const buildSql = () => {
  const nodes = flattenNodes();
  const members = require(path.join(__dirname, '..', 'src', 'data', 'organizationMembers.json'));

  const lines = [];
  lines.push('-- 조직 트리 + 인원 시드 데이터 (정적 JSON 이관)');
  lines.push('-- 멱등성: org_nodes는 ON CONFLICT(id) DO UPDATE, org_members는 (name, department) 유니크 제약이 없어');
  lines.push("--          기존 데이터를 모두 비우고 다시 INSERT 한다. 운영 환경에서 사용자 편집을 보존하려면 이 시드를 재실행하지 말 것.");
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');

  // org_nodes upsert (트리 자기참조이므로 부모 → 자식 순서)
  lines.push('-- org_nodes ─────────────────────────────────────────────────────────');
  for (const n of nodes) {
    const parent = n.parentId ? `'${esc(n.parentId)}'` : 'NULL';
    const aliases = `ARRAY[${n.departments.map((d) => `'${esc(d)}'`).join(', ')}]::text[]`;
    lines.push(
      `INSERT INTO org_nodes (id, name, parent_id, department_aliases, sort_order) VALUES ` +
        `('${esc(n.id)}', '${esc(n.name)}', ${parent}, ${aliases}, ${n.sortOrder}) ` +
        `ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, ` +
        `department_aliases=EXCLUDED.department_aliases, sort_order=EXCLUDED.sort_order;`,
    );
  }

  lines.push('');
  lines.push('-- org_members ──────────────────────────────────────────────────────');
  // 깨끗한 시드: 기존 인원 모두 제거 후 재삽입 (관리자 편집 데이터가 있다면 이 시드 재실행 금지)
  lines.push('DELETE FROM org_members;');
  lines.push('INSERT INTO org_members (name, department, position, gender, sort_order) VALUES');
  const valuesParts = members.map((m, idx) => {
    return `('${esc(m.name)}', '${esc(m.department)}', '${esc(m.position)}', '${esc(m.gender)}', ${idx})`;
  });
  lines.push(valuesParts.join(',\n') + ';');

  lines.push('');
  lines.push('COMMIT;');
  lines.push('');

  return lines.join('\n');
};

const out = buildSql();
const outPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260430120001_seed_organization.sql');
fs.writeFileSync(outPath, out, 'utf8');
console.log(`Wrote: ${outPath}`);
console.log(`  Nodes: ${flattenNodes().length}`);
console.log(`  Members: ${require(path.join(__dirname, '..', 'src', 'data', 'organizationMembers.json')).length}`);
