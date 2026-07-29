// src/utils/musicXmlVoice2.test.ts
// ピアノ譜の2声部目（voices[1]、下声など）の MusicXML 書出し・読込を確認するテスト。
// 既存の musicXmlDots.test.ts と同じ形式に揃えている（Issue #113 対応で新規作成）。
//
// .claude/specs/piano-two-voice-implementation/design.md には
// 「MusicXML書き出し・読み込みは、今回は声部2を反映しない…次回以降に持ち越す」と
// 記載されていたが、Issue #113 の往復テスト要件を満たすため、その「次回」として
// 書出し（<backup> + <voice>2</voice>）・読込の両方を実装した。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';

describe('MusicXML の声部2（voices[1]）対応', () => {
  it('声部2がある小節を export すると <backup> と <voice>2</voice> が出力される', () => {
    const data = createSavedScoreData(
      { title: 'Voice2 Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'piano-rh',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '4', isRest: false, keys: ['c/5'] },
            { dur: '4', isRest: false, keys: ['d/5'] },
            { dur: '4', isRest: false, keys: ['e/5'] },
            { dur: '4', isRest: false, keys: ['f/5'] },
          ],
          voices: [
            { id: 'voice-1', events: [] },
            { id: 'voice-2', events: [{ dur: '1', isRest: false, keys: ['c/4'] }], stemDirection: 'down' },
          ],
        }]
      }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<backup><duration>64</duration></backup>');
    expect(xml).toContain('<voice>2</voice>');
  });

  it('声部2が無い小節は export しても <backup> が出力されない（回帰防止）', () => {
    const data = createSavedScoreData(
      { title: 'No Voice2 Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }] }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    expect(xml).not.toContain('<backup>');
    expect(xml).not.toContain('<voice>2</voice>');
  });

  it('声部1・声部2を export → import すると両方の音符がそのまま復元される（ラウンドトリップ）', () => {
    const data = createSavedScoreData(
      { title: 'Voice2 Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'piano-rh',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '8', isRest: false, keys: ['c/5'] },
            { dur: '8', isRest: false, keys: ['d/5'] },
            { dur: '4', isRest: false, keys: ['e/5'] },
            { dur: '2', isRest: false, keys: ['f/5'] },
          ],
          voices: [
            { id: 'voice-1', events: [] },
            {
              id: 'voice-2',
              events: [
                { dur: '2', isRest: false, keys: ['c/4'] },
                { dur: '2', isRest: false, keys: ['g/3'] },
              ],
              stemDirection: 'down',
            },
          ],
        }]
      }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    const imported = parseMusicXml(xml);
    const measure = imported.parts[0].measures[0];

    // 声部1（primary）はこれまで通り events に復元される
    expect(measure.events.map((e) => e.keys[0])).toEqual(['c/5', 'd/5', 'e/5', 'f/5']);
    expect(measure.events.map((e) => e.dur)).toEqual(['8', '8', '4', '2']);

    // 声部2は voices[1] に復元される
    expect(measure.voices).toBeDefined();
    expect(measure.voices?.[1].events.map((e) => e.keys[0])).toEqual(['c/4', 'g/3']);
    expect(measure.voices?.[1].events.map((e) => e.dur)).toEqual(['2', '2']);
  });

  it('声部2が無い小節は export → import しても voices が付与されない（回帰防止）', () => {
    const data = createSavedScoreData(
      { title: 'No Voice2 Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }] }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    const imported = parseMusicXml(xml);
    expect(imported.parts[0].measures[0].voices).toBeUndefined();
  });

  it('声部2が休符を含む場合も export → import で復元される', () => {
    const data = createSavedScoreData(
      { title: 'Voice2 Rest Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'piano-rh',
        clef: 'treble',
        measures: [{
          events: [{ dur: '1', isRest: false, keys: ['c/5'] }],
          voices: [
            { id: 'voice-1', events: [] },
            {
              id: 'voice-2',
              events: [
                { dur: '2', isRest: true, keys: [] },
                { dur: '2', isRest: false, keys: ['c/4'] },
              ],
              stemDirection: 'down',
            },
          ],
        }]
      }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    const imported = parseMusicXml(xml);
    const voice2 = imported.parts[0].measures[0].voices?.[1].events;

    expect(voice2?.[0].isRest).toBe(true);
    expect(voice2?.[1].isRest).toBe(false);
    expect(voice2?.[1].keys[0]).toBe('c/4');
  });
});
