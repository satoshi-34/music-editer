// Issue #442: 音符選択中の ←/→ で隣のイベントへ選択を移すときの「隣の探し方」を固定する。
// 画面（PianoSystemCanvas / ScorePage）を通した操作は
// ScorePageNoteArrowNavigation.test.tsx・SingleStaffNoteArrowNavigation.test.tsx で見る。
import { describe, it, expect } from 'vitest';
import { findAdjacentNotePosition } from './noteNavigationUtils';
import type { MeasureData } from '../types/storage';

const note = (keys: string[] = ['c/5']): MeasureData['events'][number] =>
  ({ dur: '4', isRest: false, keys });
const rest = (): MeasureData['events'][number] => ({ dur: '4', isRest: true, keys: ['b/4'] });

describe('findAdjacentNotePosition（音符選択の左右移動）', () => {
  it('同じ小節の中では隣のイベントへ移る', () => {
    const measures: MeasureData[] = [{ events: [note(), note(), note()] }];
    expect(findAdjacentNotePosition(measures, 0, { measure: 0, index: 0 }, 1))
      .toEqual({ measure: 0, index: 1 });
    expect(findAdjacentNotePosition(measures, 0, { measure: 0, index: 2 }, -1))
      .toEqual({ measure: 0, index: 1 });
  });

  it('休符も移動先になる（Delete や矢印キーの対象にできる選択と同じ扱い）', () => {
    const measures: MeasureData[] = [{ events: [note(), rest()] }];
    expect(findAdjacentNotePosition(measures, 0, { measure: 0, index: 0 }, 1))
      .toEqual({ measure: 0, index: 1 });
  });

  it('小節の端では次の小節の先頭・前の小節の末尾へ移る', () => {
    const measures: MeasureData[] = [
      { events: [note(), note()] },
      { events: [note(), note(), note()] },
    ];
    // 小節1の最後 → 小節2の先頭
    expect(findAdjacentNotePosition(measures, 0, { measure: 0, index: 1 }, 1))
      .toEqual({ measure: 1, index: 0 });
    // 小節2の先頭 → 小節1の最後
    expect(findAdjacentNotePosition(measures, 0, { measure: 1, index: 0 }, -1))
      .toEqual({ measure: 0, index: 1 });
  });

  it('まだ何も書いていない小節は飛ばして探す', () => {
    const measures: MeasureData[] = [
      { events: [note()] },
      { events: [] },
      { events: [] },
      { events: [note(), note()] },
    ];
    expect(findAdjacentNotePosition(measures, 0, { measure: 0, index: 0 }, 1))
      .toEqual({ measure: 3, index: 0 });
    expect(findAdjacentNotePosition(measures, 0, { measure: 3, index: 0 }, -1))
      .toEqual({ measure: 0, index: 0 });
  });

  it('曲頭・最後のイベントより先へは進まない（null を返して呼び出し側が通知する）', () => {
    const measures: MeasureData[] = [
      { events: [note()] },
      { events: [note()] },
      { events: [] },
    ];
    expect(findAdjacentNotePosition(measures, 0, { measure: 0, index: 0 }, -1)).toBeNull();
    // 末尾の空小節をいくつ足しても「最後のイベント」の判定は変わらない
    expect(findAdjacentNotePosition(measures, 0, { measure: 1, index: 0 }, 1)).toBeNull();
  });

  it('声部2の選択では声部2のイベントだけをたどる（声部1へ乗り移らない）', () => {
    // voices[0] は measure.events の鏡（#244 段5-3 の不変条件）なので、同じ配列を入れる
    const measures: MeasureData[] = [
      {
        events: [note(['c/5']), note(['d/5']), note(['e/5'])],
        voices: [
          { id: 'voice-1', events: [note(['c/5']), note(['d/5']), note(['e/5'])] },
          { id: 'voice-2', events: [note(['c/4']), note(['d/4'])] },
        ],
      },
      {
        events: [note(['f/5'])],
        voices: [
          { id: 'voice-1', events: [note(['f/5'])] },
          { id: 'voice-2', events: [note(['e/4'])] },
        ],
      },
    ];
    // 声部2は2イベントしかないので、index 1 の次は小節をまたいで声部2の先頭へ
    expect(findAdjacentNotePosition(measures, 1, { measure: 0, index: 1 }, 1))
      .toEqual({ measure: 1, index: 0 });
    // 同じ位置でも声部1なら、まだ同じ小節に3つ目がある
    expect(findAdjacentNotePosition(measures, 0, { measure: 0, index: 1 }, 1))
      .toEqual({ measure: 0, index: 2 });
  });

  it('存在しない小節を指した選択（データが縮んだ直後など）でも落ちない', () => {
    const measures: MeasureData[] = [{ events: [note()] }];
    expect(findAdjacentNotePosition(measures, 0, { measure: 5, index: 0 }, -1))
      .toEqual({ measure: 0, index: 0 });
    expect(findAdjacentNotePosition(measures, 0, { measure: 5, index: 0 }, 1)).toBeNull();
  });
});
