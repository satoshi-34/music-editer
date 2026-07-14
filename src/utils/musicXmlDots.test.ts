// src/utils/musicXmlDots.test.ts
// 付点音符・付点休符が MusicXML の export → import を通じて保持されるかを確認するテスト。
// scoreToMusicXml / parseMusicXml はそれぞれ既存の実装ファイルにあるが、
// 対応する専用テストファイルがまだ無かったため、この付点対応の実装と合わせて新規作成する。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';

describe('MusicXML の付点対応', () => {
  it('付点4分音符(dots:1)を export すると <dot/> が1個出力される', () => {
    const data = createSavedScoreData(
      { title: 'Dots Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'], dots: 1 }] }] }],
      1,
      1
    );

    const xml = scoreToMusicXml(data);
    // dur=4分音符(DIVISIONS=16基準で16) * 1.5倍 = 24
    expect(xml).toContain('<duration>24</duration>');
    expect(xml).toContain('<dot/>');
    expect(xml).not.toContain('<dot/><dot/>');
  });

  it('複付点8分休符(dots:2)を export すると <dot/> が2個出力される', () => {
    const data = createSavedScoreData(
      { title: 'Double Dots Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '8', isRest: true, keys: [], dots: 2 }] }] }],
      1,
      1
    );

    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<dot/><dot/>');
  });

  it('付点音符を export → import すると dots がそのまま復元される（ラウンドトリップ）', () => {
    const data = createSavedScoreData(
      { title: 'Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '4', isRest: false, keys: ['c/4'], dots: 1 },
            { dur: '2', isRest: false, keys: ['d/4'], dots: 2 },
            { dur: '8', isRest: true, keys: [] },
          ]
        }]
      }],
      1,
      1
    );

    const xml = scoreToMusicXml(data);
    const imported = parseMusicXml(xml);
    const events = imported.parts[0].measures[0].events;

    expect(events[0].dots).toBe(1);
    expect(events[1].dots).toBe(2);
    expect(events[2].dots).toBeUndefined();
  });
});
