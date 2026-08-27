// src/utils/musicXmlDoubleAccidental.test.ts
// ダブルシャープ（𝄪）・ダブルフラット（𝄫）の MusicXML 書出し・読込を確認するテスト（Issue #423）。
// 既存の musicXmlMicrotone.test.ts と同じ形式に揃えている。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';

function makeScore(title: string, keys: string[]) {
  return createSavedScoreData(
    { title, subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{
      partId: 'melody',
      clef: 'treble',
      measures: [{ events: [{ dur: '4', isRest: false, keys }] }]
    }],
    1,
    1
  );
}

describe('ダブルシャープ・ダブルフラットの MusicXML 書出し', () => {
  it('𝄪 は alter 2、𝄫 は alter -2 として出力される', () => {
    expect(scoreToMusicXml(makeScore('Double Sharp Export', ['f##/4']))).toContain('<alter>2</alter>');
    expect(scoreToMusicXml(makeScore('Double Flat Export', ['ebb/4']))).toContain('<alter>-2</alter>');
  });

  it('export → import で綴り（f##/4・ebb/4）がそのまま復元される（ラウンドトリップ）', () => {
    const doubleSharp = parseMusicXml(scoreToMusicXml(makeScore('Double Sharp Roundtrip', ['f##/4'])));
    expect(doubleSharp.parts[0].measures[0].events[0].keys).toEqual(['f##/4']);

    const doubleFlat = parseMusicXml(scoreToMusicXml(makeScore('Double Flat Roundtrip', ['ebb/4'])));
    expect(doubleFlat.parts[0].measures[0].events[0].keys).toEqual(['ebb/4']);
  });
});
