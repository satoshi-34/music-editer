// Issue #313（段またぎ表示: 残りの音符のビームが連符境界を無視して再グループされる）の再発防止。
//
// 症状: 8分3連×4組の頭2音を下の五線へ出すと、残り10音のビームが1音ずつずれて
// 束ねられ（[e4, g#3, c#4] のように連符をまたぐグループになり）、連符の境界と
// ずれた見た目になっていた。
// 原因: またぎで抜けた音符を除いた列を `Beam.generateBeams` に渡していたため、
// 抜けた音符の tick（拍の内部単位）が数えられず、拍の区切りが 2/3 拍ぶんずれていた。
//
// ここでは描画側（PianoSystemCanvas）と同じ順序（連符 → ビーム）で組み立て、
// 「拍の区切りは全音符列で決め、またぎ位置では切るだけ」になっていることを固定する。
import { Beam, StaveNote } from 'vexflow';
import { describe, expect, it } from 'vitest';

import { generateCrossStaffBeams } from './crossStaffBeamUtils';
import { createVexFlowTuplets } from './vexFlowTimingUtils';

/** 描画側と同じ beamOptions（単声部の小節で使われる形） */
const BEAM_OPTIONS = { beamRests: false };

/** 8分音符を並べる（keys は「どの五線に載るか」の判定には影響しない） */
function eighthNotes(count: number): StaveNote[] {
  return Array.from({ length: count }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));
}

/** 3連符 groupCount 組ぶんのイベント列（同じ id が連続する区間が1グループ） */
function tripletEvents(groupCount: number) {
  return Array.from({ length: groupCount }, (_, group) => (
    Array.from({ length: 3 }, () => ({ tuplet: { id: `t-${group}`, numNotes: 3, notesOccupied: 2 } }))
  )).flat();
}

/** 描画側と同じ手順（連符の tick 倍率を先に反映 → ビーム）で束を作る */
function buildBeams(notes: StaveNote[], events: ReturnType<typeof tripletEvents>, renderPartIndexes: number[]) {
  createVexFlowTuplets(events, notes);
  return generateCrossStaffBeams(notes, renderPartIndexes, BEAM_OPTIONS);
}

describe('段またぎがあるときのビームの束ね方（Issue #313）', () => {
  it('3連符の頭2音を下の五線へ出しても、残りは連符の境界どおりに束ねられる', () => {
    const notes = eighthNotes(12);
    // 先頭2音だけ下の五線（パート1）へ。残り10音は自分の五線（パート0）。
    const renderPartIndexes = [1, 1, ...Array.from({ length: 10 }, () => 0)];

    const beams = buildBeams(notes, tripletEvents(4), renderPartIndexes);

    // またぎペアで1本 + 2〜4組目が各1本。3音目（連符T1の残り）は単独なので旗になる。
    expect(beams.map(beam => beam.getNotes().length)).toEqual([2, 3, 3, 3]);
    expect(notes[2].hasBeam()).toBe(false);
    // 2組目のビームが連符の頭（index 3）から始まっている＝1音ずれていない
    expect(beams[1].getNotes()[0]).toBe(notes[3]);
  });

  it('頭1音だけを出した場合も、残り2音が同じ連符内で束ねられる', () => {
    const notes = eighthNotes(12);
    const renderPartIndexes = [1, ...Array.from({ length: 11 }, () => 0)];

    const beams = buildBeams(notes, tripletEvents(4), renderPartIndexes);

    // 1音目は単独（旗）、同じ連符の2・3音目で1本、以降は連符ごとに1本。
    expect(beams.map(beam => beam.getNotes().length)).toEqual([2, 3, 3, 3]);
    expect(notes[0].hasBeam()).toBe(false);
    expect(beams[0].getNotes()[0]).toBe(notes[1]);
  });

  it('またぎが無ければ従来（Beam.generateBeams だけ）とまったく同じ束ね方になる', () => {
    const withCrossUtil = eighthNotes(12);
    const plain = eighthNotes(12);
    const flat = Array.from({ length: 12 }, () => 0);

    const utilBeams = buildBeams(withCrossUtil, tripletEvents(4), flat);
    createVexFlowTuplets(tripletEvents(4), plain);
    const plainBeams = Beam.generateBeams(plain, BEAM_OPTIONS);

    expect(utilBeams.map(beam => beam.getNotes().length))
      .toEqual(plainBeams.map(beam => beam.getNotes().length));
  });

  it('連符でない8分音符でも、拍の区切りは全音符列で決めてからまたぎ位置で切る', () => {
    const notes = eighthNotes(6);
    // 2音目だけ下の五線。拍は 2+2+2 のまま、1拍目だけがまたぎで割れる。
    const beams = generateCrossStaffBeams(notes, [0, 1, 0, 0, 0, 0], BEAM_OPTIONS);

    expect(beams.map(beam => beam.getNotes().length)).toEqual([2, 2]);
    expect(notes[0].hasBeam()).toBe(false);
    expect(notes[1].hasBeam()).toBe(false);
    // 3音目からは従来どおり拍単位で束ねられる（ずれていない）
    expect(beams[0].getNotes()[0]).toBe(notes[2]);
  });

  it('単独になった音符にはビームの参照が残らない（旗が描かれる状態になる）', () => {
    const notes = eighthNotes(4);
    // 区切りを決めるために内部で作って捨てるビームの参照が残っていると、
    // 旗もビームも描かれない裸の音符になってしまう。
    generateCrossStaffBeams(notes, [0, 1, 0, 0], BEAM_OPTIONS);

    expect(notes[0].hasBeam()).toBe(false);
    expect(notes[1].hasBeam()).toBe(false);
    expect(notes[2].hasBeam()).toBe(true);
    expect(notes[3].hasBeam()).toBe(true);
  });
});
