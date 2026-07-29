// src/utils/musicXmlHairpin.test.ts
// 松葉（クレッシェンド／ディミヌエンド、ヘアピン）の MusicXML 書出し・読込を確認するテスト。
// 既存の musicXmlDots.test.ts と同じ形式に揃えている（Issue #113 対応で新規作成）。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';

describe('MusicXML の松葉（ヘアピン）対応', () => {
  it('cresc を export すると開始位置に wedge crescendo、終了位置に wedge stop が出力される', () => {
    const data = createSavedScoreData(
      { title: 'Hairpin Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '4', isRest: false, keys: ['c/4'], hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 1 }] },
            { dur: '4', isRest: false, keys: ['d/4'] },
          ]
        }]
      }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<wedge type="crescendo"/>');
    expect(xml).toContain('<wedge type="stop"/>');
  });

  it('cresc を export → import すると同じ小節内で hairpins がそのまま復元される（ラウンドトリップ）', () => {
    const data = createSavedScoreData(
      { title: 'Hairpin Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '4', isRest: false, keys: ['c/4'], hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 2 }] },
            { dur: '4', isRest: false, keys: ['d/4'] },
            { dur: '4', isRest: false, keys: ['e/4'] },
          ]
        }]
      }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    const imported = parseMusicXml(xml);
    const events = imported.parts[0].measures[0].events;

    expect(events[0].hairpins).toEqual([{ type: 'cresc', endMeasure: 0, endEvent: 2 }]);
    expect(events[1].hairpins).toBeUndefined();
    expect(events[2].hairpins).toBeUndefined();
  });

  it('dim を export → import しても同様に復元される', () => {
    const data = createSavedScoreData(
      { title: 'Diminuendo Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '4', isRest: false, keys: ['g/4'], hairpins: [{ type: 'dim', endMeasure: 0, endEvent: 1 }] },
            { dur: '4', isRest: false, keys: ['f/4'] },
          ]
        }]
      }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    const imported = parseMusicXml(xml);
    const events = imported.parts[0].measures[0].events;

    expect(events[0].hairpins).toEqual([{ type: 'dim', endMeasure: 0, endEvent: 1 }]);
  });

  it('小節をまたぐ hairpins も export → import で endMeasure が正しく復元される', () => {
    const data = createSavedScoreData(
      { title: 'Cross Measure Hairpin Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [
          {
            events: [
              { dur: '4', isRest: false, keys: ['c/4'], hairpins: [{ type: 'cresc', endMeasure: 1, endEvent: 0 }] },
              { dur: '4', isRest: false, keys: ['d/4'] },
            ]
          },
          {
            events: [
              { dur: '4', isRest: false, keys: ['e/4'] },
              { dur: '4', isRest: false, keys: ['f/4'] },
            ]
          },
        ]
      }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    const imported = parseMusicXml(xml);
    const measure0Events = imported.parts[0].measures[0].events;

    expect(measure0Events[0].hairpins).toEqual([{ type: 'cresc', endMeasure: 1, endEvent: 0 }]);
  });

  it('hairpins の無い音符は export → import しても hairpins が付与されない', () => {
    const data = createSavedScoreData(
      { title: 'No Hairpin Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }] }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    const imported = parseMusicXml(xml);
    expect(imported.parts[0].measures[0].events[0].hairpins).toBeUndefined();
  });
});
