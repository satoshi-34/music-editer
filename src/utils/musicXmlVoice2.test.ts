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

  it('声部2の松葉（ヘアピン）は <backup> より後（声部2の音符列の側）に出力される', () => {
    const data = createSavedScoreData(
      { title: 'Voice2 Hairpin Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
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
                { dur: '2', isRest: false, keys: ['c/4'], hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 1 }] },
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

    // 声部1には松葉が無いので、wedge は <backup> より後にしか現れないこと
    const backupIndex = xml.indexOf('<backup>');
    expect(backupIndex).toBeGreaterThan(-1);
    expect(xml.indexOf('<wedge type="crescendo"/>')).toBeGreaterThan(backupIndex);
    expect(xml.indexOf('<wedge type="stop"/>')).toBeGreaterThan(backupIndex);
  });

  it('声部2の松葉は export → import で voices[1] 側に復元される（ラウンドトリップ）', () => {
    const data = createSavedScoreData(
      { title: 'Voice2 Hairpin Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
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
                { dur: '4', isRest: false, keys: ['c/4'], hairpins: [{ type: 'dim', endMeasure: 0, endEvent: 2 }] },
                { dur: '4', isRest: false, keys: ['d/4'] },
                { dur: '2', isRest: false, keys: ['e/4'] },
              ],
              stemDirection: 'down',
            },
          ],
        }]
      }],
      1,
      1
    );
    const imported = parseMusicXml(scoreToMusicXml(data));
    const measure = imported.parts[0].measures[0];

    expect(measure.voices?.[1].events[0].hairpins).toEqual([{ type: 'dim', endMeasure: 0, endEvent: 2 }]);
    expect(measure.voices?.[1].events[1].hairpins).toBeUndefined();
    expect(measure.voices?.[1].events[2].hairpins).toBeUndefined();
    // 声部1側へ漏れていないこと（声部をまたぐ松葉は作らない設計）
    expect(measure.events[0].hairpins).toBeUndefined();
  });

  it('声部1と声部2の同じ位置に松葉があっても、それぞれの声部へ別々に復元される', () => {
    const data = createSavedScoreData(
      { title: 'Both Voices Hairpin', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'piano-rh',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '2', isRest: false, keys: ['c/5'], hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 1 }] },
            { dur: '2', isRest: false, keys: ['d/5'] },
          ],
          voices: [
            { id: 'voice-1', events: [] },
            {
              id: 'voice-2',
              events: [
                { dur: '2', isRest: false, keys: ['c/4'], hairpins: [{ type: 'dim', endMeasure: 0, endEvent: 1 }] },
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
    const imported = parseMusicXml(scoreToMusicXml(data));
    const measure = imported.parts[0].measures[0];

    // 位置マップのキーが声部で分かれていないと、cresc と dim が同じ音符に2本付いてしまう
    expect(measure.events[0].hairpins).toEqual([{ type: 'cresc', endMeasure: 0, endEvent: 1 }]);
    expect(measure.voices?.[1].events[0].hairpins).toEqual([{ type: 'dim', endMeasure: 0, endEvent: 1 }]);
  });

  it('小節をまたぐ声部2の松葉も export → import で endMeasure が復元される', () => {
    const voice2 = (keys: string, hairpins?: { type: 'cresc' | 'dim'; endMeasure: number; endEvent: number }[]) => ({
      id: 'voice-2',
      events: [{ dur: '1', isRest: false, keys: [keys], ...(hairpins ? { hairpins } : {}) }],
      stemDirection: 'down' as const,
    });
    const data = createSavedScoreData(
      { title: 'Cross Measure Voice2 Hairpin', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'piano-rh',
        clef: 'treble',
        measures: [
          {
            events: [{ dur: '1', isRest: false, keys: ['c/5'] }],
            voices: [{ id: 'voice-1', events: [] }, voice2('c/4', [{ type: 'cresc', endMeasure: 1, endEvent: 0 }])],
          },
          {
            events: [{ dur: '1', isRest: false, keys: ['d/5'] }],
            voices: [{ id: 'voice-1', events: [] }, voice2('d/4')],
          },
        ],
      }],
      1,
      1
    );
    const imported = parseMusicXml(scoreToMusicXml(data));

    expect(imported.parts[0].measures[0].voices?.[1].events[0].hairpins)
      .toEqual([{ type: 'cresc', endMeasure: 1, endEvent: 0 }]);
  });

  it('声部2に松葉が無い譜面の出力は従来と1バイトも変わらない（Issue #194 のリグレッション基準）', () => {
    // Issue #194 の受入条件2。ここで比較している文字列は、この対応を入れる**前**の
    // origin/main（ee7101d）の scoreToMusicXml が同じ入力に対して返した出力そのもの。
    // 書出フォーマットを意図的に変えたときだけ、この期待値も一緒に更新すること。
    const data = createSavedScoreData(
      { title: 'Voice2 Hairpin Regression', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'piano-rh',
        clef: 'treble',
        measures: [
          {
            events: [
              { dur: '2', isRest: false, keys: ['c/5'], hairpins: [{ type: 'cresc', endMeasure: 1, endEvent: 0 }] },
              { dur: '2', isRest: false, keys: ['d/5'] },
            ],
            voices: [
              { id: 'voice-1', events: [] },
              { id: 'voice-2', events: [{ dur: '1', isRest: false, keys: ['c/4'] }], stemDirection: 'down' },
            ],
          },
          {
            events: [
              { dur: '2', isRest: false, keys: ['e/5'] },
              { dur: '2', isRest: false, keys: ['f/5'] },
            ],
          },
        ],
      }],
      1,
      1
    );

    const expected = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>Voice2 Hairpin Regression</work-title></work>
  <identification>
    <creator type="composer"></creator>
    <encoding><software>my-music-app</software></encoding>
  </identification>
  <part-list><score-part id="P1"><part-name>piano-rh</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>16</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction placement="below"><direction-type><wedge type="crescendo"/></direction-type><staff>1</staff></direction><note><pitch><step>C</step><octave>5</octave></pitch><duration>32</duration><type>half</type><voice>1</voice><staff>1</staff></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>32</duration><type>half</type><voice>1</voice><staff>1</staff></note><backup><duration>64</duration></backup><note><pitch><step>C</step><octave>4</octave></pitch><duration>64</duration><type>whole</type><voice>2</voice><staff>1</staff></note></measure><measure number="2"><note><pitch><step>E</step><octave>5</octave></pitch><duration>32</duration><type>half</type><voice>1</voice><staff>1</staff></note><direction placement="below"><direction-type><wedge type="stop"/></direction-type><staff>1</staff></direction><note><pitch><step>F</step><octave>5</octave></pitch><duration>32</duration><type>half</type><voice>1</voice><staff>1</staff></note></measure></part>
</score-partwise>`;

    expect(scoreToMusicXml(data)).toBe(expected);
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
