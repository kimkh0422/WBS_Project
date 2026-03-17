# React Joyride 사용 방식

> 앱 내 **가이드 투어(스포트라이트 투어)**를 만들 때 사용하는 [react-joyride](https://github.com/gilbarbara/react-joyride) 사용법 요약입니다.

---

## 1. 설치

```bash
npm i react-joyride
```

---

## 2. 기본 사용

필수 prop은 **`steps`** 하나입니다. 각 step은 **`target`**(요소 선택자)과 **`content`**(툴팁 내용)을 가집니다.

```tsx
import Joyride from 'react-joyride';

const steps = [
  {
    target: '.my-first-step',
    content: '이 기능을 설명하는 문구입니다.',
  },
  {
    target: '.my-other-step',
    content: '두 번째 단계 설명입니다.',
  },
];

function App() {
  return (
    <>
      <div className="my-first-step">첫 번째 요소</div>
      <div className="my-other-step">두 번째 요소</div>
      <Joyride steps={steps} />
    </>
  );
}
```

- `target`: 하이라이트할 요소. **CSS 선택자 문자열** 또는 **HTMLElement**.
- `content`: 툴팁 본문. `ReactNode`(문자열 또는 JSX) 가능.

---

## 3. Step 옵션 (각 단계별)

| 속성 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| **target** | `string` \| `HTMLElement` | (필수) | 하이라이트할 요소 (CSS 선택자 또는 DOM 요소) |
| **content** | `ReactNode` | (필수) | 툴팁 본문 |
| **title** | `ReactNode` | - | 툴팁 제목 |
| **placement** | `string` | `'bottom'` | 툴팁 위치: `top`, `bottom`, `left`, `right`, `center`, `auto` 또는 `*-start` / `*-end` |
| **disableBeacon** | `boolean` | `false` | `true`면 비콘(깜빡이는 점) 숨김 |
| **event** | `'click'` \| `'hover'` | `'click'` | 비콘을 클릭으로 열지, 호버로 열지 |
| **hideFooter** | `boolean` | `false` | 툴팁 하단(다음/이전 버튼 등) 숨김 |
| **offset** | `number` | `10` | 타겟과 툴팁 사이 거리(px) |
| **styles** | `object` | - | 이 step만 툴팁 스타일 오버라이드 |

**placement 예시**

- `'center'`: 화면 중앙에 툴팁 (이때 `target`은 보통 `'body'`)
- `'auto'`: 공간에 맞게 자동 선택
- `'bottom'`, `'top'`, `'left'`, `'right'`, `'bottom-start'`, `'top-end'` 등

---

## 4. Joyride 주요 Props (전체 투어)

| Prop | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| **steps** | `Step[]` | (필수) | 투어 단계 배열 |
| **run** | `boolean` | `true` | `true`면 투어 실행, `false`면 중지 |
| **continuous** | `boolean` | `false` | `true`면 Next로 순서대로 진행 |
| **callback** | `(data: CallBackProps) => void` | - | 단계 변경·종료·스킵 등 상태 변경 시 호출 |
| **showProgress** | `boolean` | `false` | Next 버튼에 "2/5" 형태 진행도 표시 |
| **showSkipButton** | `boolean` | `false` | "건너뛰기" 버튼 표시 |
| **stepIndex** | `number` | - | 지정 시 **제어 모드**. 현재 step 인덱스를 직접 제어 |
| **disableOverlayClose** | `boolean` | `false` | 오버레이 클릭으로 툴팁 닫기 비활성화 |
| **disableCloseOnEsc** | `boolean` | `false` | Esc로 닫기 비활성화 |
| **locale** | `object` | (영문 기본) | 버튼/안내 문구 한글화 |

**locale 한글 예시**

```tsx
const locale = {
  back: '이전',
  close: '닫기',
  last: '끝',
  next: '다음',
  skip: '건너뛰기',
};
<Joyride steps={steps} locale={locale} />
```

---

## 5. callback으로 제어 (시작/다음/종료)

투어를 **버튼으로 시작**하거나, **끝났을 때 처리**하려면 `run`과 `callback`을 함께 씁니다.

```tsx
const [run, setRun] = useState(false);
const [stepIndex, setStepIndex] = useState(0);

const steps = [
  { target: '.nav-dashboard', content: '대시보드로 이동합니다.' },
  { target: '.nav-projects', content: '프로젝트 목록을 관리합니다.' },
];

const handleJoyrideCallback = (data: CallBackProps) => {
  const { action, index, status, type } = data;
  // type: 'step:before' | 'step:after' | 'tour:start' | 'tour:end' | 'tour:status'
  // status: 'running' | 'finished' | 'skipped' | 'ready'
  if (status === 'finished' || status === 'skipped') {
    setRun(false);
    setStepIndex(0);
    return;
  }
  if (type === 'step:after' || type === 'step:before') {
    setStepIndex(index);
  }
};

return (
  <>
    <button onClick={() => setRun(true)}>투어 시작</button>
    <Joyride
      run={run}
      steps={steps}
      stepIndex={stepIndex}
      continuous
      showProgress
      showSkipButton
      callback={handleJoyrideCallback}
      locale={{ back: '이전', close: '닫기', last: '끝', next: '다음', skip: '건너뛰기' }}
    />
  </>
);
```

- **비제어**: `run`만 두고 `stepIndex` 없이 사용하면 Joyride가 내부에서 단계 관리.
- **제어**: `stepIndex`를 state로 두고 `callback`에서 `index`로 갱신하면, 외부에서 이전/다음/점프 제어 가능.

---

## 6. 타겟이 나중에 그려지는 경우

모달/탭 안 요소처럼 **마운트 시점이 늦은 요소**를 타겟으로 쓸 때:

1. **선택자 사용**: 해당 요소에 `data-id` 등을 두고 `target: '[data-id="project-add"]'` 처럼 씁니다.
2. **run 타이밍**: 해당 뷰가 렌더된 뒤에 `setRun(true)` 호출 (예: 모달 open 후 `setTimeout` 또는 `requestAnimationFrame`).
3. **ref 전달**: step에 `target: someRef.current`처럼 HTMLElement를 넘길 수 있으나, ref는 한 턴 늦게 채워질 수 있어서 보통은 **선택자 + 적절한 run 시점**이 안정적입니다.

---

## 7. 요약

| 목적 | 사용 |
|------|------|
| 투어 정의 | `steps`: 각 step에 `target`(선택자 또는 요소) + `content` |
| 순차 진행 | `continuous={true}`, 필요 시 `showProgress` |
| 시작/종료 제어 | `run` state + `callback`에서 `status === 'finished' \|\| 'skipped'`일 때 `setRun(false)` |
| 이전/다음 직접 제어 | `stepIndex` state + `callback`에서 `setStepIndex(index)` |
| 한글 버튼 | `locale` prop |
| 툴팁 위치 | step의 `placement` |

공식 문서: [React Joyride – Step](https://docs.react-joyride.com/step), [Props](https://docs.react-joyride.com/props)
