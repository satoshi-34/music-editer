// src/utils/musicXmlPedal.test.ts
// ペダル記号（NoteEvent.pedalMark）の MusicXML 書出し・読込を確認するテスト（Issue #568）。
// 既存の musicXmlHairpin.test.ts / musicXmlDynamics.test.ts と同じ形式に揃えている。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';

describe('MusicXML のペダル記号対応', () => {
  it('踏む/離すを export すると <pedal type="start"/> と <pedal type="stop"/> が出力される', () => {
    const data = createSavedScoreData(
      { title: 'Pedal Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '4', isRest: false, keys: ['c/4'], pedalMark: 'down' },
            { dur: '4', isRest: false, keys: ['d/4'] },
            { dur: '2', isRest: false, keys: ['e/4'], pedalMark: 'up' },
          ]
        }]
      }],
      1,
      1
    );

    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<pedal type="start" line="no"/>');
    expect(xml).toContain('<pedal type="stop" line="no"/>');
  });

  it('export → import でペダル記号が同じ音符に復元される（ラウンドトリップ）', () => {
    const data = createSavedScoreData(
      { title: 'Pedal Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '4', isRest: false, keys: ['c/4'], pedalMark: 'down' },
            { dur: '4', isRest: false, keys: ['d/4'] },
            { dur: '4', isRest: false, keys: ['e/4'], pedalMark: 'up' },
            { dur: '4', isRest: false, keys: ['f/4'] },
          ]
        }]
      }],
      1,
      1
    );

    const events = parseMusicXml(scoreToMusicXml(data)).parts[0].measures[0].events;
    expect(events.map((e) => e.pedalMark)).toEqual(['down', undefined, 'up', undefined]);
  });

  it('小節をまたぐペダル（1小節目で踏み、2小節目で離す）も往復で保たれる', () => {
    const data = createSavedScoreData(
      { title: 'Pedal Across Measures', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [
          { events: [
            { dur: '2', isRest: false, keys: ['c/4'], pedalMark: 'down' },
            { dur: '2', isRest: false, keys: ['d/4'] },
          ] },
          { events: [
            { dur: '2', isRest: false, keys: ['e/4'] },
            { dur: '2', isRest: false, keys: ['f/4'], pedalMark: 'up' },
          ] },
        ]
      }],
      1,
      2
    );

    const measures = parseMusicXml(scoreToMusicXml(data)).parts[0].measures;
    expect(measures[0].events.map((e) => e.pedalMark)).toEqual(['down', undefined]);
    expect(measures[1].events.map((e) => e.pedalMark)).toEqual([undefined, 'up']);
  });

  it('踏み替え（離してすぐ踏む＝連続する start）も往復で保たれる', () => {
    const data = createSavedScoreData(
      { title: 'Pedal Change', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '4', isRest: false, keys: ['c/4'], pedalMark: 'down' },
            { dur: '4', isRest: false, keys: ['d/4'], pedalMark: 'down' },
            { dur: '4', isRest: false, keys: ['e/4'], pedalMark: 'down' },
            { dur: '4', isRest: false, keys: ['f/4'], pedalMark: 'up' },
          ]
        }]
      }],
      1,
      1
    );

    const events = parseMusicXml(scoreToMusicXml(data)).parts[0].measures[0].events;
    expect(events.map((e) => e.pedalMark)).toEqual(['down', 'down', 'down', 'up']);
  });

  it('単独の「踏む」だけ（離すが無い）でも往復で保たれる', () => {
    const data = createSavedScoreData(
      { title: 'Pedal Down Only', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '2', isRest: false, keys: ['c/4'], pedalMark: 'down' },
            { dur: '2', isRest: false, keys: ['d/4'] },
          ]
        }]
      }],
      1,
      1
    );

    const events = parseMusicXml(scoreToMusicXml(data)).parts[0].measures[0].events;
    expect(events.map((e) => e.pedalMark)).toEqual(['down', undefined]);
  });

  it('大譜表（五線分割）では staff 指定に従って各段の音符へ付く', () => {
    const data = createSavedScoreData(
      { title: 'Pedal Grand Staff', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [
        { partId: 'right-hand', clef: 'treble', measures: [{ events: [
          { dur: '1', isRest: false, keys: ['c/5'] },
        ] }] },
        { partId: 'left-hand', clef: 'bass', measures: [{ events: [
          { dur: '1', isRest: false, keys: ['c/3'], pedalMark: 'down' },
        ] }] },
      ] as never,
      1,
      1,
      'piano'
    );

    const parsed = parseMusicXml(scoreToMusicXml(data));
    const right = parsed.parts.find((p) => p.partId === 'right-hand') ?? parsed.parts[0];
    const left = parsed.parts.find((p) => p.partId === 'left-hand') ?? parsed.parts[1];

    // 下段（ペダルを置いた側）にだけ付き、上段へは漏れない
    expect(left.measures[0].events[0].pedalMark).toBe('down');
    expect(right.measures[0].events[0].pedalMark).toBeUndefined();
  });

  it('声部2に置いたペダル記号も往復で保たれる', () => {
    const data = createSavedScoreData(
      { title: 'Pedal Voice2', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'piano-rh',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '1', isRest: false, keys: ['c/5'] },
          ],
          voices: [
            { id: 'voice-1', events: [] },
            {
              id: 'voice-2',
              events: [{ dur: '1', isRest: false, keys: ['c/4'], pedalMark: 'down' }],
              stemDirection: 'down',
            },
          ],
        }]
      }],
      1,
      1
    );

    const measure = parseMusicXml(scoreToMusicXml(data)).parts[0].measures[0];
    expect(measure.voices?.[1].events[0].pedalMark).toBe('down');
    expect(measure.events[0].pedalMark).toBeUndefined();
  });

  it('外部ソフトの type="change"（踏み替え）は「踏む」として取り込む', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>16</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="below"><direction-type><pedal type="start" line="no"/></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>32</duration><type>half</type></note>
      <direction placement="below"><direction-type><pedal type="change" line="no"/></direction-type></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>32</duration><type>half</type></note>
    </measure>
  </part>
</score-partwise>`;

    const events = parseMusicXml(xml).parts[0].measures[0].events;
    expect(events.map((e) => e.pedalMark)).toEqual(['down', 'down']);
  });

  it('ペダル記号の無い譜面の出力には <pedal> が現れない（回帰）', () => {
    const data = createSavedScoreData(
      { title: 'No Pedal', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [
        { dur: '4', isRest: false, keys: ['c/4'] },
      ] }] }],
      1,
      1
    );

    expect(scoreToMusicXml(data)).not.toContain('<pedal');
  });
});
