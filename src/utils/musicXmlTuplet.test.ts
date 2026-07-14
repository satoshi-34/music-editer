// src/utils/musicXmlTuplet.test.ts
// 連符（tuplet, 例: 3連符）が MusicXML の export → import を通じて保持されるかを確認するテスト。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';

describe('MusicXML の連符（tuplet）対応', () => {
  it('3連符（8分音符×3）を export すると time-modification と tuplet start/stop が出力される', () => {
    const tuplet = { id: 'g1', numNotes: 3, notesOccupied: 2 };
    const data = createSavedScoreData(
      { title: 'Tuplet Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '8', isRest: false, keys: ['c/4'], tuplet },
            { dur: '8', isRest: true, keys: [], tuplet },
            { dur: '8', isRest: true, keys: [], tuplet },
          ]
        }]
      }],
      1,
      1
    );

    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<actual-notes>3</actual-notes>');
    expect(xml).toContain('<normal-notes>2</normal-notes>');
    expect(xml).toContain('<tuplet type="start"');
    expect(xml).toContain('<tuplet type="stop"');
    // 通常の8分音符(DIVISIONS=16基準で8) * (2/3) = 5.33... -> 四捨五入で5
    expect(xml).toContain('<duration>5</duration>');
  });

  it('3連符を export → import すると tuplet フィールドがそのまま復元される（ラウンドトリップ）', () => {
    const tuplet = { id: 'g1', numNotes: 3, notesOccupied: 2 };
    const data = createSavedScoreData(
      { title: 'Tuplet Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '8', isRest: false, keys: ['c/4'], tuplet },
            { dur: '8', isRest: true, keys: [], tuplet },
            { dur: '8', isRest: true, keys: [], tuplet },
          ]
        }]
      }],
      1,
      1
    );

    const xml = scoreToMusicXml(data);
    const parsed = parseMusicXml(xml);
    const events = parsed.parts[0].measures[0].events;
    expect(events).toHaveLength(3);
    expect(events[0].tuplet).toBeTruthy();
    expect(events[0].tuplet?.numNotes).toBe(3);
    expect(events[0].tuplet?.notesOccupied).toBe(2);
    // 3イベントとも同じグループ id を共有する
    expect(events[1].tuplet?.id).toBe(events[0].tuplet?.id);
    expect(events[2].tuplet?.id).toBe(events[0].tuplet?.id);
  });

  it('tuplet が無い音符には time-modification も notations/tuplet も出力されない', () => {
    const data = createSavedScoreData(
      { title: 'No Tuplet', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }] }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    expect(xml).not.toContain('time-modification');
    expect(xml).not.toContain('<tuplet');
  });
});
