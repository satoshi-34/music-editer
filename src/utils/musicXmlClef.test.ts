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

  it('小節途中のクレフ変更（NoteEvent.clefChange）は、その音符の直前に attributes が出る（Issue #424）', () => {
    const data = createSavedScoreData(
      { title: 'Mid Measure Clef', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'right-hand',
        clef: 'treble',
        measures: [
          {
            events: [
              { dur: '4', isRest: false, keys: ['c/5'] },
              { dur: '4', isRest: false, keys: ['e/5'] },
              // 3つ目からヘ音記号（月光37小節の書き方）
              { dur: '4', isRest: false, keys: ['a/3'], clefChange: 'bass' },
              { dur: '4', isRest: false, keys: ['f/3'] },
            ],
          },
          { events: [{ dur: '1', isRest: false, keys: ['c/3'] }] },
        ],
      }],
      1,
      2,
      'single',
      'C'
    );

    const xml = scoreToMusicXml(data);
    const measure1 = xml.match(/<measure number="1">(.*?)<\/measure>/s)?.[1] ?? '';
    // 小節の途中に「clef だけの attributes」が入り、それが3つ目の音符より前にある
    expect(measure1).toContain('<attributes><clef><sign>F</sign><line>4</line></clef></attributes>');
    const midClefAt = measure1.indexOf('<attributes><clef><sign>F</sign>');
    const thirdNoteAt = measure1.indexOf('<step>A</step>');
    expect(midClefAt).toBeGreaterThan(0);
    expect(midClefAt).toBeLessThan(thirdNoteAt);

    // 次の小節は「前の小節の末尾＝ヘ音記号」を引き継ぐので、頭でもう一度出さない
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
