// src/utils/musicXmlPickup.test.ts
// アウフタクト（弱起）と MusicXML の往復テスト（Issue #473 段2）。
// 設計メモ .claude/specs/pickup-measure/design.md §5「段2」の受入テストに対応する。
//
// MusicXML では曲頭の不完全小節を <measure number="0" implicit="yes"> と書く。
// ここで固定したいのは:
//   1. 弱起ありの譜面は number="0" + implicit="yes" で書き出され、次が number="1" になる
//   2. 弱起なしの譜面の出力は従来と変わらない（implicit を出さない・番号は1始まり）
//   3. 読み込みで弱起の拍数が中身から復元でき、往復しても保たれる

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';
import type { MeasureData, PartData, TimeSignature } from '../types/storage';

/** 弱起（4分音符1つ）＋完全小節（4分音符4つ）の2小節 */
const PICKUP_MEASURE: MeasureData = { events: [{ dur: '4', isRest: false, keys: ['g/4'] }] };
const FULL_MEASURE: MeasureData = {
  events: [
    { dur: '4', isRest: false, keys: ['c/5'] },
    { dur: '4', isRest: false, keys: ['d/5'] },
    { dur: '4', isRest: false, keys: ['e/5'] },
    { dur: '4', isRest: false, keys: ['f/5'] },
  ],
};

function build(pickupBeats?: number, measures: MeasureData[] = [PICKUP_MEASURE, FULL_MEASURE], timeSignature: TimeSignature = [4, 4]) {
  const parts: PartData[] = [{ partId: 'melody', clef: 'treble', measures }];
  return createSavedScoreData(
    { title: '弱起テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts, 1, 2, 'single', 'C', timeSignature,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, pickupBeats,
  );
}

describe('MusicXML の弱起（アウフタクト・Issue #473）', () => {
  it('弱起ありの譜面は先頭が <measure number="0" implicit="yes"> で書き出される', () => {
    const xml = scoreToMusicXml(build(1));
    expect(xml).toContain('<measure number="0" implicit="yes">');
  });

  it('弱起の次の小節は number="1"（慣例どおり弱起を0と数える）', () => {
    const xml = scoreToMusicXml(build(1));
    expect(xml).toContain('<measure number="1">');
    expect(xml).not.toContain('<measure number="2">');
  });

  it('弱起なしの譜面には implicit を出さず、番号は従来どおり1始まり', () => {
    const xml = scoreToMusicXml(build(undefined));
    expect(xml).not.toContain('implicit');
    expect(xml).toContain('<measure number="1">');
    expect(xml).toContain('<measure number="2">');
  });

  it('implicit="yes" の先頭小節を読むと、中身の拍数が弱起の拍数になる', () => {
    const xml = scoreToMusicXml(build(1));
    expect(parseMusicXml(xml).pickupBeats).toBe(1);
  });

  it('書き出し → 読み込みの往復で弱起の拍数が保たれる', () => {
    // 0.5拍（8分音符1つ）の弱起
    const eighth: MeasureData = { events: [{ dur: '8', isRest: false, keys: ['g/4'] }] };
    expect(parseMusicXml(scoreToMusicXml(build(0.5, [eighth, FULL_MEASURE]))).pickupBeats).toBe(0.5);

    // 1.5拍（付点4分音符1つ）の弱起
    const dotted: MeasureData = { events: [{ dur: '4', dots: 1, isRest: false, keys: ['g/4'] }] };
    expect(parseMusicXml(scoreToMusicXml(build(1.5, [dotted, FULL_MEASURE]))).pickupBeats).toBe(1.5);
  });

  it('弱起なしの譜面を往復しても弱起は付かない', () => {
    const xml = scoreToMusicXml(build(undefined, [FULL_MEASURE, FULL_MEASURE]));
    expect(parseMusicXml(xml).pickupBeats).toBeUndefined();
  });

  it('number="0" でも中身が拍子ぶん埋まっていれば弱起にしない（誤検知を防ぐ）', () => {
    // 他ソフトが「番号0の完全小節」を書いてくることがあるため、拍数で裏を取る
    const xml = scoreToMusicXml(build(undefined, [FULL_MEASURE, FULL_MEASURE]))
      .replace('<measure number="1">', '<measure number="0" implicit="yes">');
    expect(parseMusicXml(xml).pickupBeats).toBeUndefined();
  });

  it('2小節目以降の implicit は無視して従来どおり読む（小節数が変わらない）', () => {
    const xml = scoreToMusicXml(build(undefined, [FULL_MEASURE, FULL_MEASURE]))
      .replace('<measure number="2">', '<measure number="2" implicit="yes">');
    const score = parseMusicXml(xml);
    expect(score.pickupBeats).toBeUndefined();
    expect(score.parts[0].measures).toHaveLength(2);
  });
});
