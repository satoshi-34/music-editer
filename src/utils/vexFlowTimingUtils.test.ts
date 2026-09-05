import { Beam, Formatter, Stave, StaveNote, Tuplet, Voice } from 'vexflow';
import { describe, expect, it } from 'vitest';
import {
  createVexFlowTuplets,
  syncTupletBracketsWithBeams,
  syncTupletPlacementWithNotes,
  vexFlowDotCount,
} from './vexFlowTimingUtils';

/** 連符イベント列を作る小さなヘルパー（テストの意図を読みやすくするため） */
function tupletEvents(id: string, count: number, numNotes: number, notesOccupied: number) {
  return Array.from({ length: count }, () => ({ tuplet: { id, numNotes, notesOccupied } }));
}

// Tuplet.options は protected で外から読めないため、必要な1項目だけを持つ形へ
// キャストして覗く（any を使うと lint:ratchet のエラー件数が増えてしまう）。
function isBracketed(tuplet: Tuplet): boolean {
  return (tuplet as unknown as { options: { bracketed: boolean } }).options.bracketed;
}

describe('VexFlow の拍情報変換', () => {
  it('付点を Note の dots オプションで渡し、見た目と tick を同じ長さにする', () => {
    const plain = new StaveNote({ keys: ['c/4'], duration: 'h', dots: vexFlowDotCount() });
    const dotted = new StaveNote({ keys: ['c/4'], duration: 'h', dots: vexFlowDotCount(1) });
    const doubleDotted = new StaveNote({ keys: ['c/4'], duration: 'h', dots: vexFlowDotCount(2) });

    expect(dotted.getTicks().value()).toBe(plain.getTicks().value() * 1.5);
    expect(doubleDotted.getTicks().value()).toBe(plain.getTicks().value() * 1.75);
  });

  it('3連符を Voice へ渡す前に生成して tick を 2/3 倍にする', () => {
    const notes = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));
    const normalTicks = notes[0].getTicks().value();
    const events = Array.from({ length: 3 }, () => ({
      tuplet: { id: 'triplet-1', numNotes: 3, notesOccupied: 2 },
    }));

    const tuplets = createVexFlowTuplets(events, notes);

    expect(tuplets).toHaveLength(1);
    expect(notes[0].getTicks().value()).toBe(normalTicks * (2 / 3));
  });

  it('不完全な連符グループでは tick を壊さず通常音符としてフォールバックする', () => {
    const notes = Array.from({ length: 2 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));
    const normalTicks = notes[0].getTicks().value();
    const events = Array.from({ length: 2 }, () => ({
      tuplet: { id: 'broken-triplet', numNotes: 3, notesOccupied: 2 },
    }));

    expect(createVexFlowTuplets(events, notes)).toHaveLength(0);
    expect(notes[0].getTicks().value()).toBe(normalTicks);
  });

  it('同じid内で比率が食い違う連符は通常音符として扱う', () => {
    const notes = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));
    const normalTicks = notes[0].getTicks().value();
    const events = [
      { tuplet: { id: 'mixed-ratio', numNotes: 3, notesOccupied: 2 } },
      { tuplet: { id: 'mixed-ratio', numNotes: 5, notesOccupied: 4 } },
      { tuplet: { id: 'mixed-ratio', numNotes: 3, notesOccupied: 2 } },
    ];

    expect(createVexFlowTuplets(events, notes)).toHaveLength(0);
    expect(notes[0].getTicks().value()).toBe(normalTicks);
  });

  it('有限の正整数ではない連符比率は通常音符として扱う', () => {
    const notes = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));
    const events = Array.from({ length: 3 }, () => ({
      tuplet: { id: 'invalid-ratio', numNotes: 3.5, notesOccupied: 2 },
    }));

    expect(createVexFlowTuplets(events, notes)).toHaveLength(0);
  });
});

// Issue #217: ビームが拍単位（2+2+2）に割れて連符単位（3+3）にならなかった不具合の再発防止。
// 原因は Beam.generateBeams を Tuplet 生成より先に呼んでいたこと（tick 倍率が未反映）。
// PianoSystemCanvas.tsx の描画と同じ順序・同じオプションでビームを組んで固定する。
describe('連符とビームの組み合わせ', () => {
  /** 描画側と同じ手順（連符 → ビーム）で束を作る */
  function buildBeams(notes: StaveNote[], events: ReturnType<typeof tupletEvents>) {
    const tuplets = createVexFlowTuplets(events, notes);
    const beams = Beam.generateBeams(notes, { beamRests: false });
    syncTupletBracketsWithBeams(tuplets);
    return { tuplets, beams };
  }

  it('連続する8分3連符のビームが連符単位（3+3）で束ねられる', () => {
    const notes = Array.from({ length: 6 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));
    const events = [...tupletEvents('t-1', 3, 3, 2), ...tupletEvents('t-2', 3, 3, 2)];

    const { beams } = buildBeams(notes, events);

    expect(beams.map(beam => beam.getNotes().length)).toEqual([3, 3]);
  });

  it('単独の8分3連符も3個で1つの束になる', () => {
    const notes = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));

    const { beams } = buildBeams(notes, tupletEvents('t-1', 3, 3, 2));

    expect(beams.map(beam => beam.getNotes().length)).toEqual([3]);
  });

  it('5連符（16分×5）も連符単位で1つの束になる', () => {
    const notes = Array.from({ length: 5 }, () => new StaveNote({ keys: ['c/4'], duration: '16' }));

    const { beams } = buildBeams(notes, tupletEvents('quint', 5, 5, 4));

    expect(beams.map(beam => beam.getNotes().length)).toEqual([5]);
  });

  it('連符ではない8分音符は従来どおり拍単位（2+2+2）で束ねられる', () => {
    const notes = Array.from({ length: 6 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));

    const { beams } = buildBeams(notes, Array.from({ length: 6 }, () => ({})));

    expect(beams.map(beam => beam.getNotes().length)).toEqual([2, 2, 2]);
  });

  it('連桁でつながった連符は括弧を描かず、ビームの無い連符には括弧を描く', () => {
    const beamed = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));
    const unbeamed = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/4'], duration: '4' }));

    const beamedResult = buildBeams(beamed, tupletEvents('beamed', 3, 3, 2));
    const unbeamedResult = buildBeams(unbeamed, tupletEvents('unbeamed', 3, 3, 2));

    expect(isBracketed(beamedResult.tuplets[0].tuplet)).toBe(false);
    expect(isBracketed(unbeamedResult.tuplets[0].tuplet)).toBe(true);
  });
});

// Issue #269: 連符数字をグループ単位で隠せるようにした。
// 「隠す」場合も Tuplet オブジェクト自体は作る（作らないと tick 倍率が掛からず拍が壊れる）。
describe('連符数字の非表示指定', () => {
  it('hideNumber:true でも tick は 2/3 倍になり、描画スキップの目印だけが立つ', () => {
    const notes = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));
    const normalTicks = notes[0].getTicks().value();
    const events = Array.from({ length: 3 }, () => ({
      tuplet: { id: 'hidden-triplet', numNotes: 3, notesOccupied: 2, hideNumber: true },
    }));

    const tuplets = createVexFlowTuplets(events, notes);

    expect(tuplets).toHaveLength(1);
    expect(tuplets[0].hideNumber).toBe(true);
    expect(notes[0].getTicks().value()).toBe(normalTicks * (2 / 3));
  });

  it('hideNumber が無い旧データは従来どおり表示扱いになる', () => {
    const notes = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));

    const tuplets = createVexFlowTuplets(tupletEvents('legacy', 3, 3, 2), notes);

    expect(tuplets[0].hideNumber).toBe(false);
  });
});


// Issue #471: 連符の数字が、自分の音符から五線をまたいだ反対側へ取り残される不具合。
// VexFlow は上下を符幹の向きだけで決めるため、加線の上に離れた高い音符（符幹下向き）では
// 数字が五線の下へ回り、多段譜では下の段のビームと重なって読めなくなる。
describe('連符数字の上下（五線と音符の位置関係）', () => {
  /** 連符の置き場所（上=1 / 下=-1）。options は protected なので必要な1項目だけ覗く */
  function locationOf(tuplet: Tuplet): number {
    return (tuplet as unknown as { options: { location: number } }).options.location;
  }

  /** 音符を五線に載せ、描画側と同じ順序（連符 → ビーム → 置き場所の見直し）で組む */
  function buildOnStave(keys: string[]) {
    const stave = new Stave(10, 40, 400);
    const notes = keys.map((key) => new StaveNote({ keys: [key], duration: '8' }));
    notes.forEach((note) => note.setStave(stave));
    const tuplets = createVexFlowTuplets(
      keys.map(() => ({ tuplet: { id: 'placement', numNotes: 3, notesOccupied: 2 } })),
      notes,
    );
    Beam.generateBeams(notes, { beamRests: false });
    return { stave, notes, tuplets };
  }

  it('五線より上にしかない連符は、符幹が下向きでも数字を上へ置く', () => {
    const { stave, notes, tuplets } = buildOnStave(['c/6', 'd/6', 'e/6']);

    // 前提の確認: 高い音符なので VexFlow は符幹を下向きにし、数字も下（-1）にする
    expect(notes[0].getStemDirection()).toBe(-1);
    expect(locationOf(tuplets[0].tuplet)).toBe(Tuplet.LOCATION_BOTTOM);
    expect(Math.max(...notes.flatMap((note) => note.getYs()))).toBeLessThan(stave.getYForLine(0));

    syncTupletPlacementWithNotes(tuplets);

    expect(locationOf(tuplets[0].tuplet)).toBe(Tuplet.LOCATION_TOP);
  });

  it('五線より下にしかない連符は、符幹が上向きでも数字を下へ置く', () => {
    const { stave, notes, tuplets } = buildOnStave(['c/3', 'd/3', 'e/3']);

    expect(notes[0].getStemDirection()).toBe(1);
    expect(locationOf(tuplets[0].tuplet)).toBe(Tuplet.LOCATION_TOP);
    expect(Math.min(...notes.flatMap((note) => note.getYs()))).toBeGreaterThan(stave.getYForLine(4));

    syncTupletPlacementWithNotes(tuplets);

    expect(locationOf(tuplets[0].tuplet)).toBe(Tuplet.LOCATION_BOTTOM);
  });

  it('五線にかかっている連符の置き場所は変えない（既存譜面の見た目を動かさない）', () => {
    const { tuplets } = buildOnStave(['c/4', 'd/4', 'e/4']);
    const before = locationOf(tuplets[0].tuplet);

    syncTupletPlacementWithNotes(tuplets);

    expect(locationOf(tuplets[0].tuplet)).toBe(before);
  });

  it('五線に紐づいていない音符では何もしない（位置を判断できないため）', () => {
    const notes = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/6'], duration: '8' }));
    const tuplets = createVexFlowTuplets(
      Array.from({ length: 3 }, () => ({ tuplet: { id: 'no-stave', numNotes: 3, notesOccupied: 2 } })),
      notes,
    );
    const before = locationOf(tuplets[0].tuplet);

    expect(() => syncTupletPlacementWithNotes(tuplets)).not.toThrow();
    expect(locationOf(tuplets[0].tuplet)).toBe(before);
  });
});

// Issue #574: 段またぎ連符（クロススタッフ）の数字が下の五線の中に描かれ、
// 五線の線・左手の音符と重なって読めない不具合。数字は「梁の側・五線と音符の外」へ出す。
describe('段またぎ連符の数字の置き場所（Issue #574）', () => {
  function locationOf(tuplet: Tuplet): number {
    return (tuplet as unknown as { options: { location: number } }).options.location;
  }

  /**
   * 大譜表を模した2つの五線に、8分3連の一部だけを別の五線へ載せた状態を作る。
   * 描画側と同じ順序（連符 → ビーム → 置き場所の見直し）で組み立てる。
   * crossFlags[i] が true の音符だけ下の五線に載る（＝ renderStaff: 'below' 相当）。
   */
  function buildCrossStaffTriplet(crossFlags: boolean[]) {
    const upper = new Stave(10, 40, 400);   // 第1線 y=40 …… 第5線 y=80
    const lower = new Stave(10, 140, 400);  // 第1線 y=140 …… 第5線 y=180
    const keys = ['e/4', 'c/4', 'a/3'];
    const notes = keys.map((key) => new StaveNote({ keys: [key], duration: '8' }));
    notes.forEach((note, i) => note.setStave(crossFlags[i] ? lower : upper));
    const tuplets = createVexFlowTuplets(
      keys.map(() => ({ tuplet: { id: 'cross', numNotes: 3, notesOccupied: 2 } })),
      notes,
    );
    Beam.generateBeams(notes, { beamRests: false });
    // 描画側と同じく、横位置（x）を確定させてから置き直しを呼ぶ。
    // x が無いと「連符の真下にある音符だけを避ける」絞り込みが効かない
    const voice = new Voice({ numBeats: 3, beatValue: 8 }).setStrict(false);
    voice.addTickables(notes);
    new Formatter().joinVoices([voice]).format([voice], 300);
    return { upper, lower, notes, tuplets };
  }

  it('下段へ食い込む連符（月光7〜8小節の形）の数字は、梁の側＝下の五線の下に出る', () => {
    const { upper, lower, tuplets } = buildCrossStaffTriplet([false, true, true]);

    // 持ち主は上のパート（右手）。梁は下段へ渡るので、数字も下側へ出るのが浄書の規則
    syncTupletPlacementWithNotes(tuplets, { ownerStave: upper });

    const y = tuplets[0].tuplet.getYPosition();
    expect(locationOf(tuplets[0].tuplet)).toBe(Tuplet.LOCATION_BOTTOM);
    // どちらの五線の中にも入っていない（報告された症状は「下の五線のど真ん中」だった）
    expect(y, '下の五線の第5線より下').toBeGreaterThan(lower.getYForLine(4));
    expect(y).toBeGreaterThan(upper.getYForLine(4));
  });

  it('上段へ食い込む連符（左手が上の五線へ出る形）の数字は、梁の側＝上の五線の上に出る', () => {
    const { upper, lower, tuplets } = buildCrossStaffTriplet([true, true, false]);

    // 持ち主は下のパート（左手）。またぎ先＝梁の向きは上
    syncTupletPlacementWithNotes(tuplets, { ownerStave: lower });

    const y = tuplets[0].tuplet.getYPosition();
    expect(locationOf(tuplets[0].tuplet)).toBe(Tuplet.LOCATION_TOP);
    expect(y, '上の五線の第1線より上').toBeLessThan(upper.getYForLine(0));
    expect(y).toBeLessThan(lower.getYForLine(0));
  });

  it('左手の和音が下の五線の下まで伸びていれば、数字はその下へ逃げる', () => {
    const { upper, lower, notes, tuplets } = buildCrossStaffTriplet([false, true, true]);
    const spacing = lower.getSpacingBetweenLines();
    // 連符と同じ横位置に、下の五線の第5線より 3 間下まで届く左手の和音があるとみなす
    const obstacleBottom = lower.getYForLine(4) + 3 * spacing;
    const xs = notes.map((note) => note.getAbsoluteX());
    const obstacle = {
      x: Math.min(...xs) - 5,
      y: lower.getYForLine(2),
      w: Math.max(...xs) - Math.min(...xs) + 10,
      h: obstacleBottom - lower.getYForLine(2),
    };

    syncTupletPlacementWithNotes(tuplets, { ownerStave: upper, getObstacles: () => [obstacle] });

    const y = tuplets[0].tuplet.getYPosition();
    expect(y, '左手の和音の下端より下へ逃げている').toBeGreaterThan(obstacleBottom);
  });

  it('段の下端に入り切らないときは上側へ逃がし、どちらにも入らなければ範囲内へクランプする（round3 P1）', () => {
    const { upper, lower, notes, tuplets } = buildCrossStaffTriplet([false, true, true]);
    const spacing = lower.getSpacingBetweenLines();
    // 下の五線の下 3 間まで届く左手の和音 → 本来は下へ逃げたい
    const obstacleBottom = lower.getYForLine(4) + 3 * spacing;
    const xs = notes.map((note) => note.getAbsoluteX());
    const obstacle = {
      x: Math.min(...xs) - 5, y: lower.getYForLine(2),
      w: Math.max(...xs) - Math.min(...xs) + 10, h: obstacleBottom - lower.getYForLine(2),
    };
    // 段の箱の下端が下の五線のすぐ下（余白 15px）しか無い → 下には入らない
    const bounds = { topY: 0, bottomY: lower.getYForLine(4) + 15 };
    syncTupletPlacementWithNotes(tuplets, { ownerStave: upper, getObstacles: () => [obstacle], verticalBounds: bounds });
    const y = tuplets[0].tuplet.getYPosition();
    expect(locationOf(tuplets[0].tuplet), '上側へ逃げる').toBe(Tuplet.LOCATION_TOP);
    expect(y).toBeLessThan(upper.getYForLine(0));
    expect(y).toBeGreaterThanOrEqual(bounds.topY);

    // 上にも余地が無い（箱の上端が上の五線の直上）ときは、梁の側のまま下端の内側へクランプ
    const { upper: u2, lower: l2, notes: n2, tuplets: t2 } = buildCrossStaffTriplet([false, true, true]);
    const xs2 = n2.map((note) => note.getAbsoluteX());
    const obstacle2 = { ...obstacle, x: Math.min(...xs2) - 5, w: Math.max(...xs2) - Math.min(...xs2) + 10 };
    const tight = { topY: u2.getYForLine(0) - 5, bottomY: l2.getYForLine(4) + 15 };
    syncTupletPlacementWithNotes(t2, { ownerStave: u2, getObstacles: () => [obstacle2], verticalBounds: tight });
    const y2 = t2[0].tuplet.getYPosition();
    expect(locationOf(t2[0].tuplet)).toBe(Tuplet.LOCATION_BOTTOM);
    expect(y2).toBeLessThanOrEqual(tight.bottomY);
    expect(y2).toBeGreaterThan(l2.getYForLine(4));
  });

  it('離れた場所にある音符は避ける対象にしない（数字が無関係に遠くへ飛ばない）', () => {
    const { upper, lower, notes, tuplets } = buildCrossStaffTriplet([false, true, true]);
    const far = Math.max(...notes.map((note) => note.getAbsoluteX())) + 200;
    const farObstacle = { x: far, y: lower.getYForLine(4), w: 20, h: 200 };

    syncTupletPlacementWithNotes(tuplets, { ownerStave: upper, getObstacles: () => [] });
    const withoutObstacle = tuplets[0].tuplet.getYPosition();

    syncTupletPlacementWithNotes(tuplets, { ownerStave: upper, getObstacles: () => [farObstacle] });
    expect(tuplets[0].tuplet.getYPosition()).toBeCloseTo(withoutObstacle, 5);
  });

  /**
   * 符幹の先（`getStemExtents().topY`）を差し替えて、「梁の高さがちょうど持ち主の五線の中に
   * 収まっている」状態を作る。この状態では実測では側を決められないので、
   * `isBeamSideBelow` はフォールバック（またいだ先の向き）へ落ちる。
   * VexFlow に符幹の位置を外から与える API は無いので、読んでいるメソッドだけ差し替える。
   */
  function forceStemTipY(notes: readonly StaveNote[], y: number): void {
    notes.forEach((note) => {
      (note as unknown as { getStemExtents: () => { topY: number; baseY: number } }).getStemExtents =
        () => ({ topY: y, baseY: y });
    });
  }

  it('梁が持ち主（上のパート）の五線の中に収まっているときは、またいだ先＝下へ出す', () => {
    const { upper, lower, notes, tuplets } = buildCrossStaffTriplet([false, true, true]);
    // 第3線＝五線のど真ん中。上下どちらとも言えない高さなので、実測では側を決められない
    const insideOwner = upper.getYForLine(2);
    forceStemTipY(notes, insideOwner);

    // 前提の確認: 梁の高さ（符幹の先の平均）が持ち主の五線の第1線と第5線の間にある
    expect(insideOwner, '第1線より下').toBeGreaterThan(upper.getYForLine(0));
    expect(insideOwner, '第5線より上').toBeLessThan(upper.getYForLine(4));

    syncTupletPlacementWithNotes(tuplets, { ownerStave: upper });

    // またいだ先は下の五線なので、フォールバックでも数字は下側へ出る
    expect(locationOf(tuplets[0].tuplet)).toBe(Tuplet.LOCATION_BOTTOM);
    expect(tuplets[0].tuplet.getYPosition()).toBeGreaterThan(lower.getYForLine(4));
  });

  it('梁が持ち主（下のパート）の五線の中に収まっているときは、またいだ先＝上へ出す', () => {
    const { upper, lower, notes, tuplets } = buildCrossStaffTriplet([true, true, false]);
    const insideOwner = lower.getYForLine(2);
    forceStemTipY(notes, insideOwner);

    expect(insideOwner, '第1線より下').toBeGreaterThan(lower.getYForLine(0));
    expect(insideOwner, '第5線より上').toBeLessThan(lower.getYForLine(4));

    syncTupletPlacementWithNotes(tuplets, { ownerStave: lower });

    // 持ち主が下のパートなら、またいだ先＝上の五線の側へ出る
    expect(locationOf(tuplets[0].tuplet)).toBe(Tuplet.LOCATION_TOP);
    expect(tuplets[0].tuplet.getYPosition()).toBeLessThan(upper.getYForLine(0));
  });

  it('持ち主の五線が渡されないときは、一番上の五線の持ち物として扱う（例外を出さない）', () => {
    const { lower, tuplets } = buildCrossStaffTriplet([false, true, true]);

    expect(() => syncTupletPlacementWithNotes(tuplets)).not.toThrow();
    // 一番上の五線を持ち主とみなすので、下段へ食い込む形と同じ判定になる
    expect(tuplets[0].tuplet.getYPosition()).toBeGreaterThan(lower.getYForLine(4));
  });
});
