// src/utils/musicXmlOrnament.test.ts
// モルデント・プラルトリラー・ターンの MusicXML 書出/読込（往復）を確認するテスト。
// 既存の musicXmlDots.test.ts と同じ形式に揃えている。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';
import { applyOrnamentToEvent, ornamentToVexCode, ornamentLabel } from './ornamentUtils';
import type { NoteEvent } from '../types/storage';

describe('装飾記号（モルデント・プラルトリラー・ターン）の MusicXML 対応', () => {
  it('mordent(下) を export すると <ornaments><mordent/></ornaments> が出力される', () => {
    const data = createSavedScoreData(
      { title: 'Mordent Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'], ornament: 'mordent' }] }] }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<ornaments><mordent/></ornaments>');
  });

  it('mordentInverted(上/プラルトリラー) を export すると <inverted-mordent/> が出力される', () => {
    const data = createSavedScoreData(
      { title: 'Pralltriller Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'], ornament: 'mordentInverted' }] }] }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<ornaments><inverted-mordent/></ornaments>');
  });

  it('turn を export すると <turn/> が出力される', () => {
    const data = createSavedScoreData(
      { title: 'Turn Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'], ornament: 'turn' }] }] }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<ornaments><turn/></ornaments>');
  });

  it('4種の装飾記号すべてが export → import でラウンドトリップする', () => {
    const data = createSavedScoreData(
      { title: 'Ornament Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '4', isRest: false, keys: ['c/4'], ornament: 'trill' },
            { dur: '4', isRest: false, keys: ['d/4'], ornament: 'mordent' },
            { dur: '4', isRest: false, keys: ['e/4'], ornament: 'mordentInverted' },
            { dur: '4', isRest: false, keys: ['f/4'], ornament: 'turn' },
          ],
        }],
      }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    const imported = parseMusicXml(xml);
    const events = imported.parts[0].measures[0].events;

    expect(events[0].ornament).toBe('trill');
    expect(events[1].ornament).toBe('mordent');
    expect(events[2].ornament).toBe('mordentInverted');
    expect(events[3].ornament).toBe('turn');
  });
});

describe('ornamentUtils', () => {
  it('VexFlow コードへの対応が、モルデント/プラルトリラーで意図的にねじれている', () => {
    // モルデント(下)は「波線＋縦線」のグリフが必要で、それは VexFlow の 'mordentInverted' コード。
    expect(ornamentToVexCode('mordent')).toBe('mordentInverted');
    // プラルトリラー(上)は「波線のみ」のグリフが必要で、それは VexFlow の 'mordent' コード。
    expect(ornamentToVexCode('mordentInverted')).toBe('mordent');
    expect(ornamentToVexCode('trill')).toBe('tr');
    expect(ornamentToVexCode('turn')).toBe('turn');
  });

  it('日本語ラベルを返す', () => {
    expect(ornamentLabel('trill')).toBe('トリル');
    expect(ornamentLabel('mordent')).toBe('モルデント');
    expect(ornamentLabel('mordentInverted')).toBe('プラルトリラー');
    expect(ornamentLabel('turn')).toBe('ターン');
  });

  it('applyOrnamentToEvent はトグルで付け外しする', () => {
    const ev: NoteEvent = { dur: '4', isRest: false, keys: ['c/4'] };
    const withMordent = applyOrnamentToEvent(ev, 'mordent');
    expect(withMordent.ornament).toBe('mordent');
    const removed = applyOrnamentToEvent(withMordent, 'mordent');
    expect(removed.ornament).toBeUndefined();
    // 別の種類を指定すると置き換わる（排他）
    const replaced = applyOrnamentToEvent(withMordent, 'turn');
    expect(replaced.ornament).toBe('turn');
  });
});
