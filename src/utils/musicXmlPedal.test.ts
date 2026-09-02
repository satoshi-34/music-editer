// src/utils/musicXmlPedal.test.ts
// ペダル記号（NoteEvent.pedalMark）の MusicXML 書出し・読込を確認するテスト（Issue #568）。
// 既存の musicXmlHairpin.test.ts / musicXmlDynamics.test.ts と同じ形式に揃えている。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';
import { buildPedalPlaybackPlans } from './pedalPlaybackUtils';

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

  it('小節最後の音符の後に置かれた <pedal type="stop"/> は次小節の先頭音符へ付く（round1 P1）', () => {
    // MusicXML の direction は「同じ声部で後続する最初の音符」に付く。
    // 小節ごとの処理で待ちを捨てると stop が消え、再生が譜面終端まで踏みっぱなしになる
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>16</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="below"><direction-type><pedal type="start" line="no"/></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>64</duration><type>whole</type></note>
      <direction placement="below"><direction-type><pedal type="stop" line="no"/></direction-type></direction>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>64</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

    const measures = parseMusicXml(xml).parts[0].measures;
    expect(measures[0].events[0].pedalMark).toBe('down');
    expect(measures[1].events[0].pedalMark).toBe('up');

    // 再生計画でも「1小節目いっぱいで離す」= 全音符は音価どおりで延長ゼロになること。
    // stop が失われると区間が譜面終端まで伸び、延長エントリが生まれる（round2 P2）
    const plans = buildPedalPlaybackPlans(
      [{ instrumentKey: 'p', measures }],
      4,
    );
    expect(plans[0].size).toBe(0);
  });

  it('書き出しの <pedal> は対象音符の直前に出る（位置の固定）', () => {
    const data = createSavedScoreData(
      { title: 'Pedal Position', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [
        { dur: '4', isRest: false, keys: ['c/4'] },
        { dur: '4', isRest: false, keys: ['d/4'], pedalMark: 'down' },
        { dur: '2', isRest: false, keys: ['e/4'], pedalMark: 'up' },
      ] }] }],
      1,
      1
    );

    const xml = scoreToMusicXml(data);
    // start は2音目（D）の直前、stop は3音目（E）の直前。
    // タグ存在だけの確認だと、別の音符の前に出ても通ってしまう
    const startAt = xml.indexOf('<pedal type="start"');
    const stopAt = xml.indexOf('<pedal type="stop"');
    const noteD = xml.indexOf('<step>D</step>');
    const noteE = xml.indexOf('<step>E</step>');
    const noteC = xml.indexOf('<step>C</step>');
    expect(startAt).toBeGreaterThan(noteC);
    expect(startAt).toBeLessThan(noteD);
    expect(stopAt).toBeGreaterThan(noteD);
    expect(stopAt).toBeLessThan(noteE);
  });

  it('他ソフト形式の大譜表（1パート・staves=2・backup）でも staff どおりに取り込む', () => {
    // アプリ自身の2パート形式ではなく、Finale/MuseScore が出す
    // 「1つの part に <staff>1/2</staff> と <backup>」の形を直接読む
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>16</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>64</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>64</duration></backup>
      <direction placement="below"><direction-type><pedal type="start" line="yes"/></direction-type><staff>2</staff></direction>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>32</duration><voice>5</voice><type>half</type><staff>2</staff></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>32</duration><voice>5</voice><type>half</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

    const parts = parseMusicXml(xml).parts;
    expect(parts).toHaveLength(2);
    // 右手（staff=1）には付かず、左手（staff=2）の先頭に付く。line="yes" でも読める
    expect(parts[0].measures[0].events[0].pedalMark).toBeUndefined();
    expect(parts[1].measures[0].events[0].pedalMark).toBe('down');
  });

  it('ペダルの無い譜面の書き出しは、往復しても1バイトも変わらない（冪等・回帰）', () => {
    const data = createSavedScoreData(
      { title: 'No Pedal Bytes', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [
        { dur: '4', isRest: false, keys: ['c/4'] },
        { dur: '4', isRest: true, keys: [] },
        { dur: '2', isRest: false, keys: ['e/4'] },
      ] }] }],
      1,
      1
    );

    const first = scoreToMusicXml(data);
    const reparsed = parseMusicXml(first);
    const second = scoreToMusicXml(createSavedScoreData(
      { ...reparsed.metadata },
      reparsed.parts as never,
      1,
      1
    ));
    expect(second).toBe(first);
    expect(first).not.toContain('<pedal');
  });
});
