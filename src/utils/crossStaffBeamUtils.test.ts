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

import { generateCrossStaffBeams, restoreCrossStaffBeamAssignments } from './crossStaffBeamUtils';
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
  it('3連符の頭2音を下の五線へ出すと、連符全体が1本の段またぎ連桁で繋がる（#259 段2）', () => {
    const notes = eighthNotes(12);
    // 先頭2音だけ下の五線（パート1）へ。残り10音は自分の五線（パート0）。
    const renderPartIndexes = [1, 1, ...Array.from({ length: 10 }, () => 0)];

    const beams = buildBeams(notes, tripletEvents(4), renderPartIndexes);

    // 段1では「またぎ位置で切る」＝ [2, 3, 3, 3]（3音目は旗）だったが、
    // 段2では市販譜どおり連符全体を1本のビームで五線間に渡す。
    expect(beams.map(beam => beam.getNotes().length)).toEqual([3, 3, 3, 3]);
    // 符幹の向き: 下の五線に載る頭2音は上向き（+1）、上の五線の3音目は下向き（-1）
    // ＝両方の符幹が五線の間へ向き、ビームがその間に置かれる
    expect(notes[0].getStemDirection()).toBe(1);
    expect(notes[1].getStemDirection()).toBe(1);
    expect(notes[2].getStemDirection()).toBe(-1);
    // 2組目のビームが連符の頭（index 3）から始まっている＝1音ずれていない
    expect(beams[1].getNotes()[0]).toBe(notes[3]);
  });

  it('頭1音だけを出した場合も、連符全体が1本の段またぎ連桁で繋がる（#259 段2）', () => {
    const notes = eighthNotes(12);
    const renderPartIndexes = [1, ...Array.from({ length: 11 }, () => 0)];

    const beams = buildBeams(notes, tripletEvents(4), renderPartIndexes);

    // 段1では1音目が旗＝[2,3,3,3] だったが、段2では連符ごとに1本で繋がる
    expect(beams.map(beam => beam.getNotes().length)).toEqual([3, 3, 3, 3]);
    expect(notes[0].hasBeam()).toBe(true);
    expect(beams[0].getNotes()[0]).toBe(notes[0]);
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

  it('連符でない8分音符でも、拍の区切りは全音符列で決め、またぎを含む拍は1本で繋ぐ（#259 段2）', () => {
    const notes = eighthNotes(6);
    // 2音目だけ下の五線。拍の区切り（2+2+2）はそのままで、1拍目が段またぎ連桁になる。
    const beams = generateCrossStaffBeams(notes, [0, 1, 0, 0, 0, 0], BEAM_OPTIONS);

    expect(beams.map(beam => beam.getNotes().length)).toEqual([2, 2, 2]);
    expect(notes[0].hasBeam()).toBe(true);
    expect(notes[1].hasBeam()).toBe(true);
    // 上の五線に残る1音目は下向き・下の五線へ出た2音目は上向き
    expect(notes[0].getStemDirection()).toBe(-1);
    expect(notes[1].getStemDirection()).toBe(1);
    // 2拍目からは従来どおり拍単位で束ねられる（ずれていない）
    expect(beams[1].getNotes()[0]).toBe(notes[2]);
  });

  it('拍グループに入らない音符にはビームの参照が残らない（旗が描かれる状態になる）', () => {
    // 5音（2+2+1）: 最後の1音はどの拍グループにも入らない＝旗のまま。
    // 区切りを決めるために内部で作って捨てるビームの参照が残っていると、
    // 旗もビームも描かれない裸の音符になってしまう（従来からの保護の確認）。
    const notes = eighthNotes(5);
    generateCrossStaffBeams(notes, [0, 1, 0, 0, 0], BEAM_OPTIONS);

    expect(notes[0].hasBeam()).toBe(true);
    expect(notes[1].hasBeam()).toBe(true);
    expect(notes[4].hasBeam()).toBe(false);
  });
});

describe('声部2（符幹固定オプションあり）の段またぎ連桁（Codex 1巡目 P1 の回帰）', () => {
  it('maintainStemDirections が来ても、またぎを含む拍は1本で繋がる', () => {
    // 声部2の実際の呼ばれ方: makeVFNote が自五線の音符へ down を設定済み+
    // beamOptions に { stemDirection: -1, maintainStemDirections: true }
    const notes = eighthNotes(4);
    notes.forEach((n, i) => n.setStemDirection(i === 1 ? 1 : -1)); // またぎ音符(1)は自動=上向き相当
    const voice2Options = { ...BEAM_OPTIONS, stemDirection: -1, maintainStemDirections: true };
    const beams = generateCrossStaffBeams(notes, [0, 1, 0, 0], voice2Options);

    // 区切り決定が方向の変化で分断されず、1拍目がまたぎ連桁として1本になる
    expect(beams.map((beam) => beam.getNotes().length)).toEqual([2, 2]);
    // またぎグループの向きは五線間へ（上の五線=下向き / 下の五線=上向き）
    expect(notes[0].getStemDirection()).toBe(-1);
    expect(notes[1].getStemDirection()).toBe(1);
    // 非またぎグループ（2拍目）は声部の向き固定（down）が維持される（#239）
    expect(notes[2].getStemDirection()).toBe(-1);
    expect(notes[3].getStemDirection()).toBe(-1);
  });
});

describe('整形後のビーム参照の復元（Issue #319）', () => {
  it('setStemDirection で消えたビーム参照と符幹の向きを復元する', () => {
    const notes = eighthNotes(12);
    const renderPartIndexes = [1, 1, ...Array.from({ length: 10 }, () => 0)];
    const beams = buildBeams(notes, tripletEvents(4), renderPartIndexes);

    // 合同整形中の衝突解決（ModifierContext.preFormat → StaveNote.format）を再現:
    // setStemDirection は内部で beam プロパティへ undefined を直接代入するため、
    // ビーム済みの音符から参照だけが静かに消える（これが #319 の余分な旗の原因）。
    const pairDirection = beams[0].getStemDirection();
    notes[0].setStemDirection(pairDirection === 1 ? -1 : 1);
    expect(notes[0].hasBeam()).toBe(false);

    restoreCrossStaffBeamAssignments(beams);

    // 参照が戻り、向きもビームのグループの向きへそろう
    expect(notes[0].hasBeam()).toBe(true);
    expect(notes[0].getBeam()).toBe(beams[0]);
    expect(notes[0].getStemDirection()).toBe(pairDirection);
  });

  it('ビームに属さない音符（旗の音符）には何もしない', () => {
    // 5音（2+2+1）の末尾1音は拍グループに入らない＝旗のまま
    const notes = eighthNotes(5);
    const beams = generateCrossStaffBeams(notes, [0, 1, 0, 0, 0], BEAM_OPTIONS);

    expect(notes[4].hasBeam()).toBe(false);
    restoreCrossStaffBeamAssignments(beams);
    expect(notes[4].hasBeam()).toBe(false);
  });

  it('段またぎ連桁（混在方向）の復元は、作成時点の音符ごとの向きへ戻す（段2）', () => {
    const notes = eighthNotes(2);
    const beams = generateCrossStaffBeams(notes, [0, 1], BEAM_OPTIONS);
    expect(beams).toHaveLength(1);
    // 整形中の衝突解決を再現: 上の五線の音（下向き）が反転させられ、参照も消える
    notes[0].setStemDirection(1);
    expect(notes[0].hasBeam()).toBe(false);

    restoreCrossStaffBeamAssignments(beams);

    // 一律方向（beam.getStemDirection）ではなく、混在のまま音符ごとに復元される
    expect(notes[0].hasBeam()).toBe(true);
    expect(notes[0].getStemDirection()).toBe(-1);
    expect(notes[1].getStemDirection()).toBe(1);
  });
});
