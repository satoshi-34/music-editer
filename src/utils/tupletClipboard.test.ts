// Issue #234: 連符グループ単位のコピー＆ペースト。
// ここでは「グループの取り出し・複製・貼り付け計画」という純粋なロジックだけを固定する
// （実際のクリック操作込みの確認は PianoSystemCanvasTupletCopyPaste.test.tsx 側）。
import { describe, it, expect, beforeEach } from 'vitest';

import type { NoteEvent } from '../types/storage';
import {
  copyTupletGroupForClipboard,
  findTupletGroupRange,
  instantiateTupletGroup,
  planTupletGroupPasteIntoRest,
  tupletGroupBeats,
} from './tupletUtils';
import {
  getTupletClipboardGroup,
  setTupletClipboardGroup,
  subscribeTupletClipboard,
} from './tupletClipboard';

const TRIPLET = { numNotes: 3, notesOccupied: 2 };
const tupletOf = (id: string) => ({ id, ...TRIPLET });

/** 8分3連グループ（音符1つ＋連符内休符2つ）を作る。 */
function tripletGroup(id: string, noteKey = 'c/5'): NoteEvent[] {
  const tuplet = tupletOf(id);
  return [
    { dur: '8', isRest: false, keys: [noteKey], tuplet },
    { dur: '8', isRest: true, keys: ['b/4'], tuplet },
    { dur: '8', isRest: true, keys: ['b/4'], tuplet },
  ];
}

const quarterRest = (): NoteEvent => ({ dur: '4', isRest: true, keys: ['b/4'] });
const eighthRest = (): NoteEvent => ({ dur: '8', isRest: true, keys: ['b/4'] });

describe('連符グループのコピー（tupletUtils）', () => {
  it('グループ内のどのイベントを指しても、グループ全体の範囲を返す', () => {
    const events = [quarterRest(), ...tripletGroup('g1'), quarterRest()];
    expect(findTupletGroupRange(events, 1)).toEqual({ start: 1, end: 3 });
    expect(findTupletGroupRange(events, 2)).toEqual({ start: 1, end: 3 });
    expect(findTupletGroupRange(events, 3)).toEqual({ start: 1, end: 3 });
  });

  it('連符でないイベントでは null（コピーするものが無い）', () => {
    const events = [quarterRest(), ...tripletGroup('g1')];
    expect(findTupletGroupRange(events, 0)).toBeNull();
    expect(copyTupletGroupForClipboard(events, 0)).toBeNull();
  });

  it('隣り合う別グループを巻き込まない（id が違えば別のグループ）', () => {
    const events = [...tripletGroup('g1'), ...tripletGroup('g2')];
    expect(findTupletGroupRange(events, 4)).toEqual({ start: 3, end: 5 });
    expect(copyTupletGroupForClipboard(events, 4)).toHaveLength(3);
  });

  it('コピーは元データと切り離された複製で、弧・松葉・レガシーのタイは落とす', () => {
    const events = tripletGroup('g1');
    events[0] = {
      ...events[0],
      // 他イベントを「インデックス」で指す情報は、貼り付け先では別の音符を指してしまう
      arcs: [{ fromKey: 'c/5', toKey: 'c/5', toMeasureIndex: 0, toEventIndex: 5, kind: 'tie' }],
      hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 5 }],
      tiedToNext: true,
      // 音符自身に付く記号は残す
      articulations: ['staccato'],
    } as NoteEvent;

    const copied = copyTupletGroupForClipboard(events, 0)!;
    expect(copied).toHaveLength(3);
    expect(copied[0].arcs).toBeUndefined();
    expect(copied[0].hairpins).toBeUndefined();
    expect(copied[0].tiedToNext).toBeUndefined();
    expect(copied[0].articulations).toEqual(['staccato']);

    // コピー後に元を書き換えても、コピー側は影響を受けない
    events[0].keys[0] = 'g/5';
    expect(copied[0].keys[0]).toBe('c/5');
  });

  it('貼り付けるたびに新しいグループ id を振る（元グループと共有しない）', () => {
    const group = tripletGroup('g1');
    const first = instantiateTupletGroup(group);
    const second = instantiateTupletGroup(group);

    const firstIds = new Set(first.map((ev) => ev.tuplet?.id));
    const secondIds = new Set(second.map((ev) => ev.tuplet?.id));
    // グループ内は同じ id、グループ同士は別の id
    expect(firstIds.size).toBe(1);
    expect(secondIds.size).toBe(1);
    expect([...firstIds][0]).not.toBe('g1');
    expect([...firstIds][0]).not.toBe([...secondIds][0]);
  });

  it('グループの拍数は連符の圧縮率込みで数える（8分3連=1拍）', () => {
    expect(tupletGroupBeats(tripletGroup('g1'))).toBeCloseTo(1, 6);
  });
});

describe('連符グループの貼り付け計画（planTupletGroupPasteIntoRest）', () => {
  it('同じ長さの休符へは、余りなしで置き換わる', () => {
    const plan = planTupletGroupPasteIntoRest(quarterRest(), tripletGroup('g1'))!;
    expect(plan.groupEvents).toHaveLength(3);
    expect(plan.remainingBeats).toBeCloseTo(0, 6);
  });

  it('長い休符へは、余りの拍数を返す（分割規則は Issue #224 と共通）', () => {
    const plan = planTupletGroupPasteIntoRest({ dur: '2', isRest: true, keys: ['b/4'] }, tripletGroup('g1'))!;
    expect(plan.remainingBeats).toBeCloseTo(1, 6);
  });

  it('グループより短い休符には貼れない（容量不足では何もしない）', () => {
    expect(planTupletGroupPasteIntoRest(eighthRest(), tripletGroup('g1'))).toBeNull();
  });

  it('音符・連符内の休符には貼れない（連符の入れ子を作らない）', () => {
    expect(planTupletGroupPasteIntoRest({ dur: '4', isRest: false, keys: ['c/5'] }, tripletGroup('g1'))).toBeNull();
    const insideTuplet: NoteEvent = { dur: '8', isRest: true, keys: ['b/4'], tuplet: tupletOf('other') };
    expect(planTupletGroupPasteIntoRest(insideTuplet, tripletGroup('g1'))).toBeNull();
  });
});

describe('連符グループのクリップボード（tupletClipboard）', () => {
  beforeEach(() => {
    setTupletClipboardGroup(null);
  });

  it('入れた中身をそのまま取り出せる。空配列は「空」として扱う', () => {
    const group = tripletGroup('g1');
    setTupletClipboardGroup(group);
    expect(getTupletClipboardGroup()).toBe(group);

    setTupletClipboardGroup([]);
    expect(getTupletClipboardGroup()).toBeNull();
  });

  it('購読者へ変更が通知され、解除後は呼ばれない', () => {
    const seen: (NoteEvent[] | null)[] = [];
    const unsubscribe = subscribeTupletClipboard(() => seen.push(getTupletClipboardGroup()));

    setTupletClipboardGroup(tripletGroup('g1'));
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toBeNull();

    unsubscribe();
    setTupletClipboardGroup(null);
    expect(seen).toHaveLength(1);
  });
});
