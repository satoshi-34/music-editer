// src/utils/musicXmlTupletDivisions.test.ts
// MusicXML 書き出しの <divisions> が「使われている連符で割り切れる値」に選ばれ、
// 各音符の duration が丸められずに小節の拍合計と一致することを固定する（Issue #519）。
//
// 以前は divisions=16 固定だったため、8分3連が 16×(1/2)×(2/3)=5.33… → 5 に丸められ、
// 3連×12個の小節が合計 60/64（4単位不足）になっていた。往復で拍構造が崩れる原因。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import type { NoteEvent } from '../types/storage';

/** XML 文字列から <divisions> の値を読む（最初の小節にだけ出力される） */
function readDivisions(xml: string): number {
  const m = xml.match(/<divisions>(\d+)<\/divisions>/);
  return m ? Number(m[1]) : NaN;
}

/**
 * 1小節ぶんの duration 合計を求める。
 * 和音の2音目以降（<chord/> 付き）は同じ時間を共有するので数えない。
 * <backup> の duration も時間を進めないので対象外（<note> だけを見る）。
 */
function measureDurationTotal(xml: string, measureNumber = 1): number {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const measure = doc.querySelector(`measure[number="${measureNumber}"]`);
  if (!measure) throw new Error(`measure ${measureNumber} が見つからない`);
  return Array.from(measure.querySelectorAll('note')).reduce((sum, note) => {
    if (note.querySelector('chord')) return sum;
    return sum + Number(note.querySelector('duration')?.textContent ?? '0');
  }, 0);
}

/** 小節内の全 <duration> が整数（小数点や丸めの痕跡が無い）ことを確かめる */
function allDurationsAreIntegers(xml: string): boolean {
  const durations = Array.from(xml.matchAll(/<duration>([^<]+)<\/duration>/g)).map((m) => m[1]);
  return durations.length > 0 && durations.every((d) => /^\d+$/.test(d));
}

/** 連符グループを numNotes 個ぶん作る（先頭だけ音符、残りは休符でも duration は同じ） */
function tupletGroup(
  id: string,
  dur: NoteEvent['dur'],
  numNotes: number,
  notesOccupied: number
): NoteEvent[] {
  const tuplet = { id, numNotes, notesOccupied };
  return Array.from({ length: numNotes }, (_, i) => ({
    dur,
    isRest: false,
    keys: [i === 0 ? 'c/4' : 'd/4'],
    tuplet,
  } as NoteEvent));
}

/** 1パート1小節の作品を作る */
function singleMeasureScore(events: NoteEvent[]) {
  return createSavedScoreData(
    { title: 'Divisions', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events }] }],
    1,
    1
  );
}

describe('MusicXML 書き出し: 連符に合わせた divisions（Issue #519）', () => {
  it('8分3連×4組（12音）の小節は duration 合計が divisions×4 に一致する（受入1）', () => {
    // 月光の再現条件そのもの: 4/4 の1小節を 8分3連だけで埋める
    const events = [0, 1, 2, 3].flatMap((g) => tupletGroup(`g${g}`, '8', 3, 2));
    expect(events).toHaveLength(12);

    const xml = scoreToMusicXml(singleMeasureScore(events));
    const divisions = readDivisions(xml);

    // 3で割り切れる必要があるので 16×3=48
    expect(divisions).toBe(48);
    expect(allDurationsAreIntegers(xml)).toBe(true);
    // 4/4 なので合計は 4拍ぶん。丸めが起きていれば 60/64 相当で不足する
    expect(measureDurationTotal(xml)).toBe(divisions * 4);
  });

  // 受入4: 既存対応の連符すべて（5/6/7連符）で丸めが起きないこと。
  // notesOccupied は「本来いくつぶんの音価に収まるか」なので、
  // グループ1つの実時間は (音価の拍数 × notesOccupied) 拍になる。
  it.each([
    // [説明, 音価, numNotes, notesOccupied, グループ数, 期待 divisions]
    ['3連符（8分, 3:2）', '8' as const, 3, 2, 4, 48],
    ['5連符（8分, 5:4）', '8' as const, 5, 4, 2, 80],
    ['6連符（16分, 6:4）', '16' as const, 6, 4, 4, 48],
    ['7連符（16分, 7:4）', '16' as const, 7, 4, 4, 112],
  ])('%s でも duration が整数で小節合計が divisions×4 になる（受入4）', (
    _label, dur, numNotes, notesOccupied, groupCount, expectedDivisions
  ) => {
    const events = Array.from({ length: groupCount }, (_, g) =>
      tupletGroup(`g${g}`, dur, numNotes, notesOccupied)).flat();

    const xml = scoreToMusicXml(singleMeasureScore(events));
    const divisions = readDivisions(xml);

    expect(divisions).toBe(expectedDivisions);
    expect(allDurationsAreIntegers(xml)).toBe(true);
    expect(measureDurationTotal(xml)).toBe(divisions * 4);
  });

  it('連符と通常音符が混ざった小節でも合計が合う（3連×2組＋4分音符×2）', () => {
    const events: NoteEvent[] = [
      ...tupletGroup('g0', '8', 3, 2),
      ...tupletGroup('g1', '8', 3, 2),
      { dur: '4', isRest: false, keys: ['e/4'] },
      { dur: '4', isRest: true, keys: [] },
    ];
    const xml = scoreToMusicXml(singleMeasureScore(events));
    const divisions = readDivisions(xml);

    expect(divisions).toBe(48);
    // 通常の4分音符は divisions ちょうど1つぶん（16×3）
    expect(xml).toContain('<duration>48</duration>');
    expect(measureDurationTotal(xml)).toBe(divisions * 4);
  });

  it('連符の無い作品の divisions は従来どおり16のまま（受入3・回帰）', () => {
    const events: NoteEvent[] = [
      { dur: '4', isRest: false, keys: ['c/4'] },
      { dur: '8', isRest: false, keys: ['d/4'], dots: 1 },
      { dur: '16', isRest: false, keys: ['e/4'] },
      { dur: '2', isRest: false, keys: ['f/4'] },
    ];
    const xml = scoreToMusicXml(singleMeasureScore(events));

    expect(readDivisions(xml)).toBe(16);
    // 4分=16 / 付点8分=12 / 16分=4 / 2分=32 という従来の値がそのまま出る
    expect(xml).toContain('<duration>16</duration>');
    expect(xml).toContain('<duration>12</duration>');
    expect(xml).toContain('<duration>4</duration>');
    expect(xml).toContain('<duration>32</duration>');
    expect(measureDurationTotal(xml)).toBe(16 * 4);
  });

  it('声部2にだけ連符がある場合も divisions が引き上げられる（見落とし防止）', () => {
    const data = createSavedScoreData(
      { title: 'Voice2 Tuplet', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [{ dur: '1', isRest: false, keys: ['c/4'] }],
          voices: [
            { id: 'voice-1', events: [{ dur: '1', isRest: false, keys: ['c/4'] }] },
            { id: 'voice-2', events: [0, 1, 2, 3].flatMap((g) => tupletGroup(`v2-${g}`, '8', 3, 2)) },
          ],
        }],
      }],
      1,
      1
    );

    const xml = scoreToMusicXml(data);
    expect(readDivisions(xml)).toBe(48);
    expect(allDurationsAreIntegers(xml)).toBe(true);
    // <backup> も同じ divisions 基準なので、全音符1つぶん（16×3×4拍）で巻き戻る
    expect(xml).toContain('<backup><duration>192</duration></backup>');
  });

  it('3連・5連・7連が同居しても全 duration が整数で小節合計が一致する（round1 P2: 上限撤廃）', () => {
    const events: NoteEvent[] = [
      ...tupletGroup('g3', '8', 3, 2),
      ...tupletGroup('g5', '8', 5, 4),
      ...tupletGroup('g7', '16', 7, 4),
    ];
    const xml = scoreToMusicXml(singleMeasureScore(events));
    const divisions = readDivisions(xml);

    // 当初は 960 の上限で 560 へ落としていたが、3連が 187 に丸められ小節合計が
    // divisions×4 と食い違った。厳密に必要な 16×lcm(3,5,7)=1680 をそのまま使う
    expect(divisions).toBe(1680);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const total = Array.from(doc.querySelectorAll('measure > note > duration'))
      .reduce((sum, el) => sum + parseInt(el.textContent ?? '0', 10), 0);
    // 3連(8分)×3 + 5連(8分)×5 + 7連(16分)×7 = 1拍 + 2拍 + 1拍 = 4拍
    expect(total).toBe(divisions * 4);
  });
});
