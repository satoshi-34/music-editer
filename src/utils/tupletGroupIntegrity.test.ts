// Issue #282: 連符グループの id が非連続に並ぶ（同じ id が別のグループを挟んで分断される）
// データの検出・修復・予防をまとめて固定するテスト。
//
// 実データ（月光 fixture の9小節目）で起きた壊れ方を最小形に写したものを主な入力にしている。
import { describe, expect, it } from 'vitest';

import type { MeasureData, NoteEvent, PartData } from '../types/storage';
import {
  collectTupletContinuityIssues,
  findNonContiguousTupletGroupIds,
  findTupletRunRange,
  normalizeTupletGroupContinuity,
  normalizeTupletGroupsInParts,
  snapInsertIndexOutOfTupletGroup,
} from './tupletGroupIntegrity';

/** 3連符の1音を作る簡易ヘルパー（id だけ変えれば別グループになる）。 */
function tripletNote(id: string, key = 'g#/3'): NoteEvent {
  return { dur: '8', isRest: false, keys: [key], tuplet: { id, numNotes: 3, notesOccupied: 2 } };
}

function plainNote(key = 'c/4'): NoteEvent {
  return { dur: '4', isRest: false, keys: [key] };
}

/** events の tuplet.id の並び（読みやすさのため配列で比較する）。 */
function idsOf(events: NoteEvent[]): (string | undefined)[] {
  return events.map((ev) => ev.tuplet?.id);
}

/**
 * 月光9小節目・声部2と同じ壊れ方。
 * A A A | B B B | C C [D D D] C ← グループ C が D に分断されている
 */
function brokenBar(): NoteEvent[] {
  return [
    tripletNote('A', 'g#/3'), tripletNote('A', 'b/3'), tripletNote('A', 'e/4'),
    tripletNote('B', 'g#/3'), tripletNote('B', 'b/3'), tripletNote('B', 'e/4'),
    tripletNote('C', 'g#/3'), tripletNote('C', 'b/3'),
    tripletNote('D', 'e/4'), tripletNote('D', 'g#/3'), tripletNote('D', 'b/3'),
    tripletNote('C', 'e/4'),
  ];
}

describe('findNonContiguousTupletGroupIds（分断の検出）', () => {
  it('正常なデータでは空配列を返す', () => {
    const events = [
      tripletNote('A'), tripletNote('A'), tripletNote('A'),
      plainNote(),
      tripletNote('B'), tripletNote('B'), tripletNote('B'),
    ];
    expect(findNonContiguousTupletGroupIds(events)).toEqual([]);
  });

  it('同じ id が別グループを挟んで現れたら、その id を返す', () => {
    expect(findNonContiguousTupletGroupIds(brokenBar())).toEqual(['C']);
  });

  it('連符でないイベントを挟んだだけでも「分断」として検出する（グループは連続が前提のため）', () => {
    const events = [tripletNote('A'), plainNote(), tripletNote('A')];
    expect(findNonContiguousTupletGroupIds(events)).toEqual(['A']);
  });
});

describe('normalizeTupletGroupContinuity（読込時の修復）', () => {
  it('分断が無ければ引数の配列をそのまま返す（正常データには一切触れない）', () => {
    const events = [tripletNote('A'), tripletNote('A'), tripletNote('A'), plainNote()];
    expect(normalizeTupletGroupContinuity(events)).toBe(events);
  });

  it('分断されたグループを numNotes ごとに区切り直し、4つの連続したグループにする', () => {
    const normalized = normalizeTupletGroupContinuity(brokenBar());
    const ids = idsOf(normalized);

    // 先頭2グループは元のまま（区切り位置が変わらないので id を据え置く）。
    expect(ids.slice(0, 3)).toEqual(['A', 'A', 'A']);
    expect(ids.slice(3, 6)).toEqual(['B', 'B', 'B']);
    // 後半6音は 3 音ずつに割り直され、それぞれ1つの id で揃う。
    expect(new Set(ids.slice(6, 9)).size).toBe(1);
    expect(new Set(ids.slice(9, 12)).size).toBe(1);
    expect(ids[6]).not.toBe(ids[9]);
    // どの id も2か所に分かれていない＝分断が解消している。
    expect(findNonContiguousTupletGroupIds(normalized)).toEqual([]);
    // グループ数は 4 のまま（増えても減ってもいない）。
    expect(new Set(ids).size).toBe(4);
  });

  it('音符の並び・音価・拍数は一切変えない（書き換えるのは tuplet.id だけ）', () => {
    const before = brokenBar();
    const after = normalizeTupletGroupContinuity(before);
    expect(after.map((ev) => ev.keys)).toEqual(before.map((ev) => ev.keys));
    expect(after.map((ev) => ev.dur)).toEqual(before.map((ev) => ev.dur));
    expect(after.map((ev) => ev.isRest)).toEqual(before.map((ev) => ev.isRest));
    expect(after.map((ev) => ev.tuplet?.numNotes)).toEqual(before.map((ev) => ev.tuplet?.numNotes));
    expect(after.map((ev) => ev.tuplet?.notesOccupied)).toEqual(before.map((ev) => ev.tuplet?.notesOccupied));
    // 元の配列は書き換えていない（読込元のデータを破壊しない）。
    expect(idsOf(before)).toEqual(['A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'D', 'D', 'D', 'C']);
  });

  it('同じ入力からは必ず同じ id が出る（measure.events と voices[0] の食い違いを防ぐため）', () => {
    expect(idsOf(normalizeTupletGroupContinuity(brokenBar())))
      .toEqual(idsOf(normalizeTupletGroupContinuity(brokenBar())));
  });

  it('割り切れずに余った端数は、それだけで別グループとして分離する', () => {
    // A A [B B] A ← 5音しかないので、3音＋2音に割れる
    const events = [
      tripletNote('A'), tripletNote('A'),
      tripletNote('B'), tripletNote('B'),
      tripletNote('A'),
    ];
    const ids = idsOf(normalizeTupletGroupContinuity(events));
    expect(new Set(ids.slice(0, 3)).size).toBe(1);
    expect(new Set(ids.slice(3, 5)).size).toBe(1);
    expect(ids[0]).not.toBe(ids[3]);
    expect(findNonContiguousTupletGroupIds(normalizeTupletGroupContinuity(events))).toEqual([]);
  });

  it('種類の違う連符（3連符と5連符）はまたいで区切り直さない', () => {
    const quintuplet = (id: string): NoteEvent => ({
      dur: '8', isRest: false, keys: ['c/4'], tuplet: { id, numNotes: 5, notesOccupied: 4 },
    });
    const events = [
      tripletNote('A'), tripletNote('A'), quintuplet('Q'), tripletNote('A'),
    ];
    const ids = idsOf(normalizeTupletGroupContinuity(events));
    // 5連符は 3連符の区間に巻き込まれず、id も変わらない。
    expect(ids[2]).toBe('Q');
    // 3連符側は前後2つの区間に分かれ、それぞれ別グループになる。
    expect(ids[0]).toBe(ids[1]);
    expect(ids[3]).not.toBe(ids[0]);
  });

  it('numNotes が壊れている（0 など）データは区切り直さず、離れた同じ id を切り離すだけにする', () => {
    const bad = (id: string): NoteEvent => ({
      dur: '8', isRest: false, keys: ['c/4'], tuplet: { id, numNotes: 0, notesOccupied: 2 },
    });
    const normalized = normalizeTupletGroupContinuity([bad('A'), bad('B'), bad('A')]);
    const ids = idsOf(normalized);
    // 区切り幅が決まらないので numNotes 単位の割り直しはしない（先頭2つは元のまま）。
    expect(ids.slice(0, 2)).toEqual(['A', 'B']);
    // 離れて再登場した A だけを別グループへ切り離す。
    expect(ids[2]).not.toBe('A');
    expect(findNonContiguousTupletGroupIds(normalized)).toEqual([]);
  });

  it('連符でない音符を挟んで分断されている場合も、後ろの断片を別グループへ切り離す', () => {
    const events = [tripletNote('A'), plainNote(), tripletNote('A')];
    const normalized = normalizeTupletGroupContinuity(events);
    expect(idsOf(normalized)[0]).toBe('A');
    expect(idsOf(normalized)[2]).not.toBe('A');
    expect(findNonContiguousTupletGroupIds(normalized)).toEqual([]);
  });

  it('hideNumber などグループの設定は引き継ぐ', () => {
    const withHidden = brokenBar().map((ev) => ({
      ...ev,
      tuplet: { ...ev.tuplet!, hideNumber: true },
    }));
    const normalized = normalizeTupletGroupContinuity(withHidden);
    expect(normalized.every((ev) => ev.tuplet?.hideNumber === true)).toBe(true);
  });
});

describe('normalizeTupletGroupsInParts（譜面全体）', () => {
  function partWithVoice2(events: NoteEvent[]): PartData {
    const measure: MeasureData = {
      events: [plainNote()],
      voices: [{ events: [plainNote()] }, { events }],
    } as MeasureData;
    return { id: 'right-hand', clef: 'treble', measures: [measure] } as PartData;
  }

  it('声部2（voices[1]）の分断も直る', () => {
    const [part] = normalizeTupletGroupsInParts([partWithVoice2(brokenBar())]);
    const voice2 = part.measures[0].voices![1].events;
    expect(findNonContiguousTupletGroupIds(voice2)).toEqual([]);
    expect(new Set(idsOf(voice2)).size).toBe(4);
  });

  it('measure.events と voices[0] が同じ内容なら、直したあとの id も同じになる', () => {
    const measure: MeasureData = {
      events: brokenBar(),
      voices: [{ events: brokenBar() }],
    } as MeasureData;
    const part = { id: 'right-hand', clef: 'treble', measures: [measure] } as PartData;
    const [normalized] = normalizeTupletGroupsInParts([part]);
    expect(idsOf(normalized.measures[0].events))
      .toEqual(idsOf(normalized.measures[0].voices![0].events));
  });

  it('分断が無い譜面は参照ごとそのまま返す（無駄な再描画を起こさない）', () => {
    const parts = [partWithVoice2([tripletNote('A'), tripletNote('A'), tripletNote('A')])];
    expect(normalizeTupletGroupsInParts(parts)).toEqual(parts);
    expect(normalizeTupletGroupsInParts(parts)[0]).toBe(parts[0]);
  });
});

describe('collectTupletContinuityIssues（保存前の検証）', () => {
  it('分断されている場所（パート・小節・声部）と id を返す', () => {
    const measure: MeasureData = {
      events: [plainNote()],
      voices: [{ events: [plainNote()] }, { events: brokenBar() }],
    } as MeasureData;
    const parts = [{ id: 'right-hand', clef: 'treble', measures: [measure] } as PartData];
    expect(collectTupletContinuityIssues(parts)).toEqual([
      { partIndex: 0, measureIndex: 0, voiceIndex: 1, tupletIds: ['C'] },
    ]);
  });

  it('正常な譜面では空配列を返す', () => {
    const measure: MeasureData = {
      events: [tripletNote('A'), tripletNote('A'), tripletNote('A')],
    } as MeasureData;
    const parts = [{ id: 'right-hand', clef: 'treble', measures: [measure] } as PartData];
    expect(collectTupletContinuityIssues(parts)).toEqual([]);
  });
});

describe('snapInsertIndexOutOfTupletGroup（挿入位置の予防）', () => {
  const events = [
    plainNote(),
    tripletNote('A'), tripletNote('A'), tripletNote('A'),
    plainNote(),
  ];

  it('連符の外を指しているときはそのまま', () => {
    expect(snapInsertIndexOutOfTupletGroup(events, 0)).toBe(0);
    // index 1 は「グループの先頭の手前」＝ まだ外側なので動かさない。
    expect(snapInsertIndexOutOfTupletGroup(events, 1)).toBe(1);
    expect(snapInsertIndexOutOfTupletGroup(events, 4)).toBe(4);
    expect(snapInsertIndexOutOfTupletGroup(events, events.length)).toBe(events.length);
  });

  it('グループの内側を指したら、近いほうの境界へ寄せる', () => {
    // 2音目の手前 → 手前側（1）が近い
    expect(snapInsertIndexOutOfTupletGroup(events, 2)).toBe(1);
    // 3音目の手前 → 直後（4）が近い
    expect(snapInsertIndexOutOfTupletGroup(events, 3)).toBe(4);
  });

  it('範囲外の値を渡しても配列の中へ収める', () => {
    expect(snapInsertIndexOutOfTupletGroup(events, -5)).toBe(0);
    expect(snapInsertIndexOutOfTupletGroup(events, 99)).toBe(events.length);
  });

  it('寄せた位置へ挿入すれば分断が起きない（この修正が守りたい性質）', () => {
    const at = snapInsertIndexOutOfTupletGroup(events, 2);
    const inserted = [...events];
    inserted.splice(at, 0, plainNote('d/4'));
    expect(findNonContiguousTupletGroupIds(inserted)).toEqual([]);

    // 寄せなかった場合はこうなる、という対比（＝Issue #282 の発生経路）。
    const broken = [...events];
    broken.splice(2, 0, plainNote('d/4'));
    expect(findNonContiguousTupletGroupIds(broken)).toEqual(['A']);
  });
});

describe('findTupletRunRange（グループ範囲の数え方）', () => {
  it('連符でない位置では null', () => {
    expect(findTupletRunRange([plainNote()], 0)).toBeNull();
  });

  it('分断されたデータでは、連続している断片だけを返す', () => {
    // 分断されたまま「グループ全体」を掴めないことの確認（だから読込時に直す）。
    expect(findTupletRunRange(brokenBar(), 6)).toEqual({ start: 6, end: 7 });
    expect(findTupletRunRange(brokenBar(), 11)).toEqual({ start: 11, end: 11 });
  });
});
