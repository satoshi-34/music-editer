// src/utils/scoreEditorNotices.test.ts
// 削除通知の文言（Issue #238）を固定するテスト。
//
// 文言そのものより大事なのは「実際に消えるもの」と「通知の内容」がずれないこと。
// 分岐は utils/noteDeletionUtils.ts の deleteEventFromMeasures と同じ順序でなければならず、
// ここではその順序（和音の1音 → 連符グループ → イベント単体）を機械的に固定する。

import { describe, it, expect } from 'vitest';
import type { NoteEvent } from '../types/storage';
import {
  UNDO_HINT,
  describeClearedMeasures,
  describeDeletedArc,
  describeDeletedHairpin,
  describeDeletedNoteEvent,
} from './scoreEditorNotices';

const note = (over: Partial<NoteEvent> = {}): NoteEvent => ({
  dur: '4',
  isRest: false,
  keys: ['c/4'],
  ...over,
});

describe('describeDeletedNoteEvent', () => {
  it('単音の削除は「音符を削除しました」', () => {
    expect(describeDeletedNoteEvent(note())).toBe(`音符を削除しました${UNDO_HINT}`);
  });

  it('休符の削除は「休符を削除しました」', () => {
    expect(describeDeletedNoteEvent(note({ isRest: true, keys: ['b/4'] })))
      .toBe(`休符を削除しました${UNDO_HINT}`);
  });

  it('和音の1音だけを選んでいるときは「和音の1音」と伝える', () => {
    const chord = note({ keys: ['c/4', 'e/4', 'g/4'] });
    expect(describeDeletedNoteEvent(chord, 1)).toBe(`和音の1音を削除しました${UNDO_HINT}`);
  });

  it('和音でも符頭を選んでいなければ和音まるごとの削除として伝える', () => {
    const chord = note({ keys: ['c/4', 'e/4'] });
    expect(describeDeletedNoteEvent(chord)).toBe(`和音を削除しました${UNDO_HINT}`);
  });

  it('連符の中の音符はグループごと消えるので「N連符グループ」と伝える', () => {
    const tripletNote = note({ dur: '8', tuplet: { id: 't1', numNotes: 3, notesOccupied: 2 } });
    expect(describeDeletedNoteEvent(tripletNote)).toBe(`3連符グループを削除しました${UNDO_HINT}`);
  });

  it('連符の中の和音で符頭を選んでいるときは、連符より「和音の1音」が優先される', () => {
    // deleteEventFromMeasures は和音の分岐を連符より先に置いている（Issue #223）。
    // 文言だけ連符グループになると「グループが消えた」と誤解させてしまう。
    const chordInTuplet = note({
      keys: ['c/4', 'e/4'],
      tuplet: { id: 't1', numNotes: 3, notesOccupied: 2 },
    });
    expect(describeDeletedNoteEvent(chordInTuplet, 0)).toBe(`和音の1音を削除しました${UNDO_HINT}`);
  });

  it('休符は keyIndex を渡されても「和音の1音」にはならない', () => {
    const rest = note({ isRest: true, keys: ['b/4', 'd/5'] });
    expect(describeDeletedNoteEvent(rest, 0)).toBe(`休符を削除しました${UNDO_HINT}`);
  });
});

describe('弧・松葉・小節の削除', () => {
  it('タイとスラーを言い分ける', () => {
    expect(describeDeletedArc('tie')).toBe(`タイを削除しました${UNDO_HINT}`);
    expect(describeDeletedArc('slur')).toBe(`スラーを削除しました${UNDO_HINT}`);
  });

  it('松葉は向きで言い分ける', () => {
    expect(describeDeletedHairpin('cresc')).toContain('クレッシェンド（松葉）を削除しました');
    expect(describeDeletedHairpin('dim')).toContain('デクレッシェンド（松葉）を削除しました');
  });

  it('小節範囲は画面表記（1始まり）に直して伝える', () => {
    expect(describeClearedMeasures(0, 0)).toBe(`1小節目の音符を削除しました${UNDO_HINT}`);
    expect(describeClearedMeasures(2, 5)).toBe(`3〜6小節目の音符を削除しました${UNDO_HINT}`);
  });
});
