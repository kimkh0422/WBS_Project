/**
 * 표 트리(작업명 들여쓰기)에 그릴 가이드 선을 행별 문자열로 계산한다.
 *
 * 입력은 화면에 보이는 순서(부모→자식 pre-order)의 작업 목록이며 각 항목의 `depth`(0=최상위)를 쓴다.
 * 반환 문자열의 각 문자가 한 depth 칸을 의미한다:
 *   'I' = 세로선(│, 조상 가지가 아래로 계속됨)
 *   ' ' = 공백(조상이 막내라 더 그릴 선 없음)
 *   'T' = ├ (이 행이 막내가 아님 — 아래 형제로 세로선 이어짐)
 *   'L' = └ (이 행이 막내)
 * depth가 0이면 빈 문자열.
 */
export function computeTreeGuideStrings(list: ReadonlyArray<{ id: string; depth?: number }>): Map<string, string> {
  const n = list.length;
  const out = new Map<string, string>();
  if (n === 0) return out;

  const depthOf = (i: number): number => {
    const d = list[i].depth ?? 0;
    return d > 0 ? d : 0;
  };

  // 1) 각 행이 형제 중 막내인지(isLast) 한 번에 계산. (단조 스택, O(n))
  const isLast = new Array<boolean>(n).fill(true);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = depthOf(i);
    while (stack.length > 0 && depthOf(stack[stack.length - 1]!) >= d) {
      const top = stack.pop()!;
      // 같은 depth가 뒤에 또 나왔다는 건 형제가 더 있다는 뜻 → 막내 아님
      if (depthOf(top) === d) isLast[top] = false;
    }
    stack.push(i);
  }

  // 2) pre-order로 훑으며 조상별 "막내 여부"를 유지해 가이드 문자열을 만든다.
  const ancestorIsLastByDepth: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const d = depthOf(i);
    let s = '';
    for (let level = 0; level < d; level++) {
      if (level < d - 1) {
        // 조상 칸: 그 조상이 막내가 아니면 세로선이 이 행을 지나 계속됨
        s += ancestorIsLastByDepth[level] ? ' ' : 'I';
      } else {
        // 자기 칸(부모에서 갈라지는 자리): 막내면 └, 아니면 ├
        s += isLast[i] ? 'L' : 'T';
      }
    }
    ancestorIsLastByDepth[d] = isLast[i];
    ancestorIsLastByDepth.length = d + 1; // 더 깊은 칸의 묵은 값 제거
    out.set(list[i].id, s);
  }
  return out;
}
