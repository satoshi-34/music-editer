// Issue #309（段またぎ記譜 段1a）: 「どの五線に描くか」を決める純粋ロジックの検証。
//
// ここで固定するのは次の3点。
//   1. 相手の五線が無いときは必ず自分の五線へフォールバックする（例外を出さない）
//   2. 段またぎを使っていない譜面では「またぎ音符あり」と判定しない（描画の従来経路を守る）
//   3. 連桁を切る位置＝載る五線が変わる位置でグループが分かれる
import { describe, expect, it } from 'vitest';

import type { RenderStaffDirection } from './crossStaffUtils';
import {
  isRenderStaffDirection,
  resolveRenderPartIndex,
  resolveRenderPartIndexes,
  hasCrossStaffRender,
  groupIndexesByRenderTarget,
} from './crossStaffUtils';

describe('段またぎ記譜の五線解決（Issue #309）', () => {
  it('ピアノ譜（2段）で右手の below は下の五線、左手の above は上の五線を指す', () => {
    expect(resolveRenderPartIndex(0, 'below', 2)).toBe(1);
    expect(resolveRenderPartIndex(1, 'above', 2)).toBe(0);
  });

  it('指定が無ければ自分の五線（従来どおり）', () => {
    expect(resolveRenderPartIndex(0, undefined, 2)).toBe(0);
    expect(resolveRenderPartIndex(1, undefined, 2)).toBe(1);
  });

  it('端のパートで行き先が無い向きは自分の五線へフォールバックする', () => {
    // 最上段の above（上に五線が無い）／最下段の below（下に五線が無い）
    expect(resolveRenderPartIndex(0, 'above', 2)).toBe(0);
    expect(resolveRenderPartIndex(1, 'below', 2)).toBe(1);
  });

  it('単段の編成・パート譜表示（パートが1つ）では両方向とも自分の五線へフォールバックする', () => {
    expect(resolveRenderPartIndex(0, 'below', 1)).toBe(0);
    expect(resolveRenderPartIndex(0, 'above', 1)).toBe(0);
  });

  it('未知の値（旧データ・手書きJSON）は段またぎ指定として扱わない', () => {
    expect(isRenderStaffDirection('below')).toBe(true);
    expect(isRenderStaffDirection('above')).toBe(true);
    expect(isRenderStaffDirection('under')).toBe(false);
    expect(isRenderStaffDirection(true)).toBe(false);
    expect(isRenderStaffDirection(undefined)).toBe(false);
    // 型としては通らない値でも、保存データ経由で紛れ込む可能性があるので落ちないことを確認する
    expect(resolveRenderPartIndex(0, 'under' as unknown as RenderStaffDirection, 2)).toBe(0);
  });

  it('イベント配列から一括で解決でき、またぎの有無も判定できる', () => {
    const events = [
      { renderStaff: 'below' as const },
      { renderStaff: undefined },
      { renderStaff: 'below' as const },
    ];
    expect(resolveRenderPartIndexes(events, 0, 2)).toEqual([1, 0, 1]);
    expect(hasCrossStaffRender([1, 0, 1], 0)).toBe(true);
    // 段またぎを1つも使っていない譜面（従来の描画経路をそのまま通す条件）
    expect(hasCrossStaffRender([0, 0, 0], 0)).toBe(false);
    // フォールバックで自分の五線に戻った場合も「またぎ無し」として扱う
    expect(hasCrossStaffRender(resolveRenderPartIndexes(events, 1, 2), 1)).toBe(false);
  });
});

describe('連桁を切る位置のグループ分け（Issue #309）', () => {
  it('載る五線が変わる位置でグループが分かれる', () => {
    expect(groupIndexesByRenderTarget([0, 0, 1, 1, 0])).toEqual([[0, 1], [2, 3], [4]]);
  });

  it('全部同じ五線なら1グループのまま（従来のビームと同じ束ね方になる）', () => {
    expect(groupIndexesByRenderTarget([0, 0, 0])).toEqual([[0, 1, 2]]);
  });

  it('空配列でも落ちない', () => {
    expect(groupIndexesByRenderTarget([])).toEqual([]);
  });
});
