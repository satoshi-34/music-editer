// src/utils/musicXmlRehearsalMark.test.ts
// リハーサルマーク（練習番号）が MusicXML の export/import で
// 正しく往復する（書き出し→読み込みで元の値に戻る）かを確認するテスト。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';

describe('MusicXML のリハーサルマーク対応', () => {
  it('rehearsalMark があると <direction-type><rehearsal> が出力される', () => {
    const data = createSavedScoreData(
      { title: 'Rehearsal Mark Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [
          { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] },
          { events: [{ dur: '4', isRest: false, keys: ['c/4'] }], rehearsalMark: 'B' },
        ],
      }],
      1,
      2,
      'single',
      'C'
    );

    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<rehearsal>B</rehearsal>');
    // 1小節目には無いことも確認する
    const measure1 = xml.match(/<measure number="1">(.*?)<\/measure>/s)?.[1] ?? '';
    expect(measure1).not.toContain('<rehearsal>');
  });

  it('export → import で rehearsalMark が復元される', () => {
    const data = createSavedScoreData(
      { title: 'Rehearsal Mark Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [
          { events: [{ dur: '4', isRest: false, keys: ['c/4'] }], rehearsalMark: 'A' },
          { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] },
          { events: [{ dur: '4', isRest: false, keys: ['c/4'] }], rehearsalMark: 'AA' },
        ],
      }],
      1,
      3,
      'single',
      'C'
    );

    const xml = scoreToMusicXml(data);
    const parsed = parseMusicXml(xml);
    const measures = parsed.parts[0].measures;
    expect(measures[0].rehearsalMark).toBe('A');
    expect(measures[1].rehearsalMark).toBeUndefined();
    expect(measures[2].rehearsalMark).toBe('AA');
  });
});
