// src/utils/musicXmlKeySignature.test.ts
// 途中調号変更（小節単位の keySignature）が MusicXML の export / import で
// 正しく往復するかを確認するテスト。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';

describe('MusicXML の途中調号変更対応', () => {
  it('3小節目に keySignature があると、その小節の attributes に fifths が出力される', () => {
    const data = createSavedScoreData(
      { title: 'Key Change Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [
          { events: [{ dur: '4', isRest: false, keys: ['g/4'] }] },
          { events: [{ dur: '4', isRest: false, keys: ['g/4'] }] },
          { events: [{ dur: '4', isRest: false, keys: ['f/4'] }], keySignature: 'F' },
        ],
      }],
      1,
      3,
      'single',
      'G' // グローバル調号は G dur（♯1つ）
    );

    const xml = scoreToMusicXml(data);
    // 1小節目: グローバル調号 G dur = fifths 1
    expect(xml).toMatch(/<measure number="1">.*<fifths>1<\/fifths>/s);
    // 3小節目: F dur へ変更 = fifths -1
    expect(xml).toMatch(/<measure number="3">.*<fifths>-1<\/fifths>/s);
    // 2小節目は調号が変わらないので attributes 自体を出力しない
    const measure2 = xml.match(/<measure number="2">(.*?)<\/measure>/s)?.[1] ?? '';
    expect(measure2).not.toContain('<key>');
  });

  it('途中調号変更を export → import すると 3小節目以降に keySignature が復元される', () => {
    const data = createSavedScoreData(
      { title: 'Key Change Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [
          { events: [{ dur: '4', isRest: false, keys: ['g/4'] }] },
          { events: [{ dur: '4', isRest: false, keys: ['g/4'] }] },
          { events: [{ dur: '4', isRest: false, keys: ['f/4'] }], keySignature: 'F' },
          { events: [{ dur: '4', isRest: false, keys: ['f/4'] }] },
        ],
      }],
      1,
      4,
      'single',
      'G'
    );

    const xml = scoreToMusicXml(data);
    const parsed = parseMusicXml(xml);
    const measures = parsed.parts[0].measures;
    expect(measures[0].keySignature).toBeUndefined();
    expect(measures[1].keySignature).toBeUndefined();
    expect(measures[2].keySignature).toBe('F');
    // 4小節目は調号指定なし（3小節目の変更を継続する想定なので、そのまま省略でよい）
    expect(measures[3].keySignature).toBeUndefined();
    expect(parsed.keySignature).toBe('G');
  });
});
