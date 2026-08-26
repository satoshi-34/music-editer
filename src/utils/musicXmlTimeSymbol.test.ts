// src/utils/musicXmlTimeSymbol.test.ts
// 拍子の記号表記（Issue #422）が MusicXML の <time symbol="..."> と
// 往復できるかを確認するテスト。数字（beats / beat-type）は記号表示でも変わらない
// ＝「データは 2/2 のまま、見た目だけ 𝄵」であることをここで固定する。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';
import type { PartData, TimeSignature, TimeSignatureStyle } from '../types/storage';

const PART: PartData[] = [{
  partId: 'melody',
  clef: 'treble',
  measures: [{ events: [{ dur: '2', isRest: false, keys: ['c/4'] }] }],
}];

function build(timeSignature: TimeSignature, style: TimeSignatureStyle) {
  return createSavedScoreData(
    { title: 'Cut Time', subtitle: '', lyricist: '', composer: '', arranger: '' },
    PART,
    1,
    1,
    'single',
    'C',
    timeSignature,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    style
  );
}

describe('MusicXML の拍子記号表記（Issue #422）', () => {
  it('2/2＋記号表示は <time symbol="cut"> で書き出される（数字は 2/2 のまま）', () => {
    const xml = scoreToMusicXml(build([2, 2], 'symbol'));
    expect(xml).toContain('<time symbol="cut">');
    expect(xml).toContain('<beats>2</beats><beat-type>2</beat-type>');
  });

  it('4/4＋記号表示は <time symbol="common"> で書き出される', () => {
    const xml = scoreToMusicXml(build([4, 4], 'symbol'));
    expect(xml).toContain('<time symbol="common">');
  });

  it('数字表示のときは symbol 属性を付けない（旧データと同じ出力＝回帰なし）', () => {
    const xml = scoreToMusicXml(build([2, 2], 'numeric'));
    expect(xml).toContain('<time><beats>2</beats>');
    expect(xml).not.toContain('symbol=');
  });

  it('記号を持たない拍子（6/8）は記号表示を指定しても symbol 属性を付けない', () => {
    const xml = scoreToMusicXml(build([6, 8], 'symbol'));
    expect(xml).toContain('<time><beats>6</beats>');
    expect(xml).not.toContain('symbol=');
  });

  it('symbol="cut" の MusicXML を読み込むと、拍子 2/2 ＋記号表示として復元される', () => {
    const xml = scoreToMusicXml(build([2, 2], 'symbol'));
    const loaded = parseMusicXml(xml);
    expect(loaded.timeSignature).toEqual([2, 2]);
    expect(loaded.timeSignatureStyle).toBe('symbol');
  });

  it('symbol 属性が無い MusicXML は数字表示として読み込まれる', () => {
    const xml = scoreToMusicXml(build([2, 2], 'numeric'));
    const loaded = parseMusicXml(xml);
    expect(loaded.timeSignature).toEqual([2, 2]);
    expect(loaded.timeSignatureStyle).toBe('numeric');
  });

  // #422 round1 P2: 記号表記の対象は譜面先頭の拍子だけ。小節単位の拍子変更に
  // symbol を付けると、読込側は先頭しか見ないため往復でスタイルが消える。
  // 「途中に 2/2 の小節変更がある symbol 譜面」の往復でスタイルが保たれることを固定する
  it('小節単位の拍子変更には symbol を付けず、往復でスタイルが保たれる', () => {
    const data = build([2, 2], 'symbol');
    data.parts[0].measures.push({ events: [{ dur: '1', isRest: true, keys: [] }], timeSignature: [2, 2] });
    const xml = scoreToMusicXml(data);
    // 先頭の拍子にだけ symbol が付く
    expect(xml.match(/symbol="cut"/g)?.length).toBe(1);
    // 往復してもスタイルは symbol のまま
    const reparsed = parseMusicXml(xml);
    expect(reparsed.timeSignatureStyle).toBe('symbol');
    const xml2 = scoreToMusicXml(reparsed);
    expect(xml2).toContain('symbol="cut"');
  });
});
