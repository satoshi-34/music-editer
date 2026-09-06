// src/editor/clickCycleUtils.test.ts
// Issue #264（クリック対象の再クリック巡回）の判定ロジックの単体テスト。
//
// ここで固定したいのは、運用者が決めた仕様そのもの:
//   1回目のクリック  … 従来の決定的な優先順位（＝巡回しない）
//   同じ場所の再クリック … 次の候補へ。一巡したら先頭へ戻る
// 加えて、再描画で DOM 要素が作り直されても巡回が進み続けること（IDで覚えている理由）も
// 「候補の配列を毎回作り直しても結果が変わらない」形で確認する。
import { describe, it, expect } from 'vitest';

import {
  CLICK_CYCLE_TOLERANCE_PX,
  armClickCycle,
  isSameClickPoint,
  planClickCycle,
  type ClickCycleState,
} from './clickCycleUtils';

// 手前（前面）から奥の順。音符が手前、スラーがその下にある想定。
const CANDIDATES = ['note:p0:m0:v0:e1', 'arc:p0v0m0e0a0'];
const NOTE = CANDIDATES[0];
const ARC = CANDIDATES[1];

describe('isSameClickPoint', () => {
  it('状態が無ければ常に false（＝どこであっても1回目のクリック扱い）', () => {
    expect(isSameClickPoint(null, 10, 20)).toBe(false);
  });

  it('許容誤差の内側なら同じ場所とみなす', () => {
    const state: ClickCycleState = { clientX: 100, clientY: 200, consumed: [NOTE] };
    expect(isSameClickPoint(state, 100 + CLICK_CYCLE_TOLERANCE_PX, 200)).toBe(true);
    expect(isSameClickPoint(state, 100, 200 - CLICK_CYCLE_TOLERANCE_PX)).toBe(true);
  });

  it('許容誤差を1pxでも超えたら別の場所とみなす', () => {
    const state: ClickCycleState = { clientX: 100, clientY: 200, consumed: [NOTE] };
    expect(isSameClickPoint(state, 100 + CLICK_CYCLE_TOLERANCE_PX + 1, 200)).toBe(false);
    expect(isSameClickPoint(state, 100, 200 + CLICK_CYCLE_TOLERANCE_PX + 1)).toBe(false);
  });
});

describe('planClickCycle（1回目は従来どおり・2回目から巡回）', () => {
  it('1回目のクリック（状態なし）では巡回しない', () => {
    expect(planClickCycle(null, 100, 200, CANDIDATES, NOTE)).toBeNull();
  });

  it('別の場所のクリックでは巡回しない', () => {
    const state: ClickCycleState = { clientX: 100, clientY: 200, consumed: [NOTE] };
    expect(planClickCycle(state, 300, 200, CANDIDATES, NOTE)).toBeNull();
  });

  it('候補が1つしかなければ巡回しない（切り替える相手がいない）', () => {
    const state: ClickCycleState = { clientX: 100, clientY: 200, consumed: [NOTE] };
    expect(planClickCycle(state, 100, 200, [NOTE], NOTE)).toBeNull();
  });

  it('同じ場所の2回目は次の候補（奥のスラー）を返す', () => {
    const state: ClickCycleState = { clientX: 100, clientY: 200, consumed: [NOTE] };
    const plan = planClickCycle(state, 100, 200, CANDIDATES, NOTE);
    expect(plan).toEqual({ nextId: ARC, consumed: [NOTE, ARC] });
  });

  it('一巡したら先頭（自分自身）へ戻るので巡回せず通常処理に落とす', () => {
    const state: ClickCycleState = { clientX: 100, clientY: 200, consumed: [NOTE, ARC] };
    expect(planClickCycle(state, 100, 200, CANDIDATES, NOTE)).toBeNull();
  });

  it('候補3つでは 音符→スラー→松葉→音符 の順で一巡する', () => {
    const three = [NOTE, ARC, 'hairpin:p0v0m0e0h0'];
    let state: ClickCycleState = { clientX: 10, clientY: 10, consumed: [NOTE] };

    const second = planClickCycle(state, 10, 10, three, NOTE);
    expect(second?.nextId).toBe(three[1]);
    state = { ...state, consumed: second!.consumed };

    const third = planClickCycle(state, 10, 10, three, NOTE);
    expect(third?.nextId).toBe(three[2]);
    state = { ...state, consumed: third!.consumed };

    // 3つとも選び終えたので先頭へ戻る＝自分自身なので通常処理へ
    expect(planClickCycle(state, 10, 10, three, NOTE)).toBeNull();
  });

  it('自分が候補に含まれていなければ巡回しない（安全側）', () => {
    const state: ClickCycleState = { clientX: 100, clientY: 200, consumed: [NOTE] };
    expect(planClickCycle(state, 100, 200, CANDIDATES, 'note:p9:m9:v0:e9')).toBeNull();
  });

  it('候補が減っていても（弧を消した後など）残った候補だけで巡回が成立する', () => {
    // 前回はスラーまで選んでいたが、そのスラーが消えて候補が音符だけになった状態。
    const state: ClickCycleState = { clientX: 100, clientY: 200, consumed: [NOTE, ARC] };
    expect(planClickCycle(state, 100, 200, [NOTE], NOTE)).toBeNull();
  });
});

describe('armClickCycle（選んだ対象を覚える）', () => {
  it('初回はその座標の1件目として覚える', () => {
    expect(armClickCycle(null, 100, 200, NOTE)).toEqual({ clientX: 100, clientY: 200, consumed: [NOTE] });
  });

  it('座標が変わったら前の場所の進み具合は捨てる', () => {
    const state: ClickCycleState = { clientX: 100, clientY: 200, consumed: [NOTE, ARC] };
    expect(armClickCycle(state, 400, 200, NOTE)).toEqual({ clientX: 400, clientY: 200, consumed: [NOTE] });
  });

  it('同じ場所なら進み具合に積み増す', () => {
    const state: ClickCycleState = { clientX: 100, clientY: 200, consumed: [NOTE] };
    expect(armClickCycle(state, 100, 200, ARC)).toEqual({ clientX: 100, clientY: 200, consumed: [NOTE, ARC] });
  });

  it('同じIDを二重に積まない', () => {
    const state: ClickCycleState = { clientX: 100, clientY: 200, consumed: [NOTE] };
    expect(armClickCycle(state, 100, 200, NOTE)).toBe(state);
  });
});

describe('通しシナリオ: 音符→スラー→音符（再描画をまたいでも進む）', () => {
  // PianoSystemCanvas 側の呼び出し方をそのまま真似る。
  // 巡回しなかったとき（plan === null）は進み具合を捨ててから覚え直す、が呼び出し側の約束。
  function clickAt(state: ClickCycleState | null, x: number, y: number, candidates: string[], selfId: string) {
    const plan = planClickCycle(state, x, y, candidates, selfId);
    if (plan) return { selected: plan.nextId, state: { clientX: x, clientY: y, consumed: plan.consumed } };
    return { selected: selfId, state: armClickCycle(null, x, y, selfId) };
  }

  it('クリックのたびに候補配列を作り直しても 音符→スラー→音符→スラー と巡回する', () => {
    let state: ClickCycleState | null = null;
    const selected: string[] = [];

    // 手前の音符がクリックを受け取り続ける（SVG は毎回作り直される想定で配列も作り直す）
    for (let i = 0; i < 4; i++) {
      const result = clickAt(state, 50, 60, [...CANDIDATES], NOTE);
      selected.push(result.selected);
      state = result.state;
    }

    expect(selected).toEqual([NOTE, ARC, NOTE, ARC]);
  });

  it('途中で別の場所をクリックすると巡回はリセットされ、戻ってきても1件目から始まる', () => {
    let state: ClickCycleState | null = null;
    const selected: string[] = [];

    let result = clickAt(state, 50, 60, [...CANDIDATES], NOTE);
    selected.push(result.selected);
    state = result.state;

    // 遠く離れた別の音符をクリック
    result = clickAt(state, 400, 60, ['note:p0:m0:v0:e5'], 'note:p0:m0:v0:e5');
    selected.push(result.selected);
    state = result.state;

    // 元の場所へ戻る → 1回目のクリック扱い（従来の優先順位＝手前の音符）
    result = clickAt(state, 50, 60, [...CANDIDATES], NOTE);
    selected.push(result.selected);

    expect(selected).toEqual([NOTE, 'note:p0:m0:v0:e5', NOTE]);
  });
});
