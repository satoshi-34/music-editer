// src/utils/musicXmlClef.test.ts
// 途中クレフ変更（小節単位の clef）が MusicXML の export で
// 正しく出力されるかを確認するテスト。
// 読み込み側（musicXmlImport.ts）は工数の都合でパートごとの単一クレフ判定のみ対応し、
// 小節単位の途中クレフ変更の読み込みは対象外とする（design.md の「現状の制限」を参照）。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';

describe('MusicXML の途中クレフ変更対応（書き出し）', () => {
  it('3小節目に clef があると、その小節の attributes に clef が出力される', () => {
    const data = createSavedScoreData(
      { title: 'Clef Change Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'cello',
        clef: 'bass',
        measures: [
          { events: [{ dur: '4', isRest: false, keys: ['c/3'] }] },
          { events: [{ dur: '4', isRest: false, keys: ['c/3'] }] },
          { events: [{ dur: '4', isRest: false, keys: ['c/4'] }], clef: 'tenor' },
        ],
      }],
      1,
      3,
      'single',
      'C'
    );

    const xml = scoreToMusicXml(data);
    // 1小節目: パート既定のヘ音記号（F, line 4）
    expect(xml).toMatch(/<measure number="1">.*<clef><sign>F<\/sign><line>4<\/line><\/clef>/s);
    // 3小節目: テナー記号（C, line 4）へ変更
    expect(xml).toMatch(/<measure number="3">.*<clef><sign>C<\/sign><line>4<\/line><\/clef>/s);
    // 2小節目はクレフが変わらないので clef 自体を出力しない
    const measure2 = xml.match(/<measure number="2">(.*?)<\/measure>/s)?.[1] ?? '';
    expect(measure2).not.toContain('<clef>');
  });

  it('パート既定クレフがアルト記号のとき、既定クレフの MusicXML は C/line3 で出力される', () => {
    const data = createSavedScoreData(
      { title: 'Alto Clef Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'viola',
        clef: 'alto',
        measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }],
      }],
      1,
      1,
      'single',
      'C'
    );
    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<clef><sign>C</sign><line>3</line></clef>');
  });

  it('テナー記号のパートを export → import すると、パート既定クレフとして tenor が復元される', () => {
    const data = createSavedScoreData(
      { title: 'Tenor Clef Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'cello',
        clef: 'tenor',
        measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }],
      }],
      1,
      1,
      'single',
      'C'
    );
    const xml = scoreToMusicXml(data);
    const parsed = parseMusicXml(xml);
    expect(parsed.parts[0].clef).toBe('tenor');
  });
});
