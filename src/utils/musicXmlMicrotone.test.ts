// src/utils/musicXmlMicrotone.test.ts
// 微分音（四分音）の MusicXML 書出しを確認するテスト。
// 既存の musicXmlOrnament.test.ts と同じ形式に揃えている。
// 読込（import）側は今回のスコープ外（design.md 参照）のため、書出しのみ確認する。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';

describe('微分音（四分音）の MusicXML 書出し', () => {
  it('quarterSharp を export すると alter 0.5 と accidental quarter-sharp が出力される', () => {
    const data = createSavedScoreData(
      { title: 'Quarter Sharp Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [{
            dur: '4',
            isRest: false,
            keys: ['c/4'],
            microtones: [{ keyIndex: 0, type: 'quarterSharp' }]
          }]
        }]
      }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<alter>0.5</alter>');
    expect(xml).toContain('<accidental>quarter-sharp</accidental>');
  });

  it('quarterFlat を export すると alter -0.5 と accidental quarter-flat が出力される', () => {
    const data = createSavedScoreData(
      { title: 'Quarter Flat Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [{
            dur: '4',
            isRest: false,
            keys: ['d/4'],
            microtones: [{ keyIndex: 0, type: 'quarterFlat' }]
          }]
        }]
      }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<alter>-0.5</alter>');
    expect(xml).toContain('<accidental>quarter-flat</accidental>');
  });

  it('和音の一部の音にだけ microtone が付いていても、他の音は通常どおり出力される', () => {
    const data = createSavedScoreData(
      { title: 'Chord Microtone Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [{
            dur: '4',
            isRest: false,
            keys: ['c/4', 'e/4'],
            microtones: [{ keyIndex: 1, type: 'quarterSharp' }]
          }]
        }]
      }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    // 1音目（c/4）は通常のピッチのまま、2音目（e/4）だけ四分音上げになる
    expect(xml).toContain('<step>C</step>');
    expect(xml).toContain('<alter>0.5</alter>');
    expect(xml).toContain('<accidental>quarter-sharp</accidental>');
  });

  it('microtones が無い音符は従来どおり alter/accidental を出力しない', () => {
    const data = createSavedScoreData(
      { title: 'No Microtone Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }]
      }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    expect(xml).not.toContain('quarter-sharp');
    expect(xml).not.toContain('quarter-flat');
  });
});
