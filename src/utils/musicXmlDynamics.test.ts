// src/utils/musicXmlDynamics.test.ts
// 文字の強弱記号（pp〜ff）の MusicXML 読み込みを確認するテスト（Issue #552）。
//
// 書き出し（dynamicsDirectionXml）は以前からあったが読み込み側に <dynamics> の
// 解釈が無く、自分で書き出したファイルでも往復で p・f が消えていた。
// 既存の musicXmlHairpin.test.ts と同じ形式に揃えている。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml, parseMusicXmlWithDefaults } from './musicXmlImport';

/** 単旋律1パート・1小節の譜面データを作る小さなヘルパー */
function singlePartScore(events: unknown[], title = 'Dynamics') {
  return createSavedScoreData(
    { title, subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events }] }] as never,
    1,
    1
  );
}

describe('MusicXML の文字強弱（pp〜ff）読み込み（Issue #552）', () => {
  it('p と f を export → import すると、置いた音符へそのまま復元される（往復）', () => {
    const data = singlePartScore([
      { dur: '4', isRest: false, keys: ['c/4'], dynamics: [{ value: 'p' }] },
      { dur: '4', isRest: false, keys: ['d/4'] },
      { dur: '4', isRest: false, keys: ['e/4'], dynamics: [{ value: 'f' }] },
      { dur: '4', isRest: false, keys: ['g/4'] },
    ]);

    const events = parseMusicXml(scoreToMusicXml(data)).parts[0].measures[0].events;

    expect(events[0].dynamics).toEqual([{ value: 'p' }]);
    expect(events[1].dynamics).toBeUndefined();
    expect(events[2].dynamics).toEqual([{ value: 'f' }]);
    expect(events[3].dynamics).toBeUndefined();
  });

  it('同じ小節にある松葉と文字強弱が両方とも取り込まれる（共存）', () => {
    const data = singlePartScore([
      {
        dur: '4', isRest: false, keys: ['c/4'],
        dynamics: [{ value: 'p' }],
        hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 2 }],
      },
      { dur: '4', isRest: false, keys: ['d/4'] },
      { dur: '4', isRest: false, keys: ['e/4'], dynamics: [{ value: 'ff' }] },
      { dur: '4', isRest: false, keys: ['g/4'] },
    ]);

    const events = parseMusicXml(scoreToMusicXml(data)).parts[0].measures[0].events;

    expect(events[0].dynamics).toEqual([{ value: 'p' }]);
    expect(events[0].hairpins).toEqual([{ type: 'cresc', endMeasure: 0, endEvent: 2 }]);
    expect(events[2].dynamics).toEqual([{ value: 'ff' }]);
  });

  it('声部2に置いた強弱も、その声部の音符へ復元される', () => {
    const data = createSavedScoreData(
      { title: 'Dynamics Voice2', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '2', isRest: false, keys: ['c/5'], dynamics: [{ value: 'mf' }] },
            { dur: '2', isRest: false, keys: ['d/5'] },
          ],
          voices: [
            { id: 'voice-1', events: [
              { dur: '2', isRest: false, keys: ['c/5'], dynamics: [{ value: 'mf' }] },
              { dur: '2', isRest: false, keys: ['d/5'] },
            ] },
            { id: 'voice-2', events: [
              { dur: '1', isRest: false, keys: ['c/4'], dynamics: [{ value: 'pp' }] },
            ], stemDirection: 'down' },
          ],
        }]
      }] as never,
      1,
      1
    );

    const measure = parseMusicXml(scoreToMusicXml(data)).parts[0].measures[0];

    expect(measure.events[0].dynamics).toEqual([{ value: 'mf' }]);
    expect(measure.voices?.[1].events[0].dynamics).toEqual([{ value: 'pp' }]);
  });

  it('大譜表（五線分割）では staff 指定に従って各段の音符へ付く', () => {
    const data = createSavedScoreData(
      { title: 'Dynamics Grand Staff', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [
        { partId: 'right-hand', clef: 'treble', measures: [{ events: [
          { dur: '1', isRest: false, keys: ['c/5'], dynamics: [{ value: 'f' }] },
        ] }] },
        { partId: 'left-hand', clef: 'bass', measures: [{ events: [
          { dur: '1', isRest: false, keys: ['c/3'], dynamics: [{ value: 'pp' }] },
        ] }] },
      ] as never,
      1,
      1,
      'piano'
    );

    const parsed = parseMusicXml(scoreToMusicXml(data));
    const right = parsed.parts.find((p) => p.partId === 'right-hand') ?? parsed.parts[0];
    const left = parsed.parts.find((p) => p.partId === 'left-hand') ?? parsed.parts[1];

    // 上段には f だけ、下段には pp だけ（両段へ二重に付かない）
    expect(right.measures[0].events[0].dynamics).toEqual([{ value: 'f' }]);
    expect(left.measures[0].events[0].dynamics).toEqual([{ value: 'pp' }]);
  });

  it('対応表に無い強弱（sfz 等）は取り込まず、件数を返す（読み込み自体は成功する）', () => {
    // 外部ソフトが書き出した「sfz と p が混ざった」ファイルを模す
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>16</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="below"><direction-type><dynamics><sfz/></dynamics></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>32</duration><type>half</type></note>
      <direction placement="below"><direction-type><dynamics><p/></dynamics></direction-type></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>32</duration><type>half</type></note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXmlWithDefaults(xml);
    const events = result.score.parts[0].measures[0].events;

    // sfz は付けない（近い記号へ勝手に寄せない）。p はこれまでどおり取り込む
    expect(events[0].dynamics).toBeUndefined();
    expect(events[1].dynamics).toEqual([{ value: 'p' }]);
    expect(result.unsupportedDynamicsCount).toBe(1);
  });

  it('強弱記号が1つも無いファイルでは、取り込めなかった件数を返さない（回帰防止）', () => {
    const data = singlePartScore([
      { dur: '1', isRest: false, keys: ['c/4'] },
    ]);

    const result = parseMusicXmlWithDefaults(scoreToMusicXml(data));

    expect(result.unsupportedDynamicsCount).toBeUndefined();
    expect(result.score.parts[0].measures[0].events[0].dynamics).toBeUndefined();
  });

  it('声部3の強弱も往復で復元される（round1 P2）', () => {
    const events = [{ dur: '4' as const, isRest: false, keys: ['c/5'] },
      { dur: '4' as const, isRest: true, keys: [] },
      { dur: '4' as const, isRest: true, keys: [] },
      { dur: '4' as const, isRest: true, keys: [] }];
    const v3 = [{ dur: '4' as const, isRest: false, keys: ['e/4'], dynamics: [{ value: 'f' as const }] },
      { dur: '4' as const, isRest: true, keys: [] },
      { dur: '4' as const, isRest: true, keys: [] },
      { dur: '4' as const, isRest: true, keys: [] }];
    const score = createSavedScoreData(
      { title: 'v3', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{
        events,
        voices: [
          { id: 'voice-1', events },
          { id: 'voice-2', events: [{ dur: '1', isRest: true, keys: [] }], stemDirection: 'down' },
          { id: 'voice-3', events: v3, stemDirection: 'down' },
        ],
      }] }] as never,
      1,
      1,
    );
    const xml = scoreToMusicXml(score);
    const imported = parseMusicXml(xml);
    expect(imported.parts[0].measures[0].voices?.[2]?.events?.[0]?.dynamics)
      .toEqual([{ value: 'f' }]);
  });

  it('重複した <dynamics> は1件に畳む（round1 P3: 同一 direction 群の p p）', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>M</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="below"><direction-type><dynamics><p/></dynamics></direction-type></direction>
      <direction placement="below"><direction-type><dynamics><p/></dynamics></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const imported = parseMusicXml(xml);
    expect(imported.parts[0].measures[0].events[0].dynamics).toEqual([{ value: 'p' }]);
  });

  it('本物の大譜表（staves=2・backup・声部5）で staff 指定どおり振り分ける（round1 P2）', () => {
    // MuseScore/Finale 相当: 1つの <part> に <staves>2</staves>。
    // 上段（staff1）に p・下段（staff2・voice5）に f。和音の構成音（<chord/>）は
    // イベント数に数えないことも同時に固定する
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <direction placement="below"><direction-type><dynamics><p/></dynamics></direction-type><staff>1</staff></direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><type>half</type><voice>1</voice><staff>1</staff></note>
      <note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>8</duration><type>half</type><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>8</duration><type>half</type><voice>1</voice><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <direction placement="below"><direction-type><dynamics><f/></dynamics></direction-type><staff>2</staff></direction>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><type>whole</type><voice>5</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const imported = parseMusicXml(xml);
    const right = imported.parts.find((pt) => pt.clef === 'treble')!;
    const left = imported.parts.find((pt) => pt.clef === 'bass')!;
    // 上段: p は1音目（和音）へ。<chord/> を数えると2音目へずれる
    expect(right.measures[0].events[0].dynamics).toEqual([{ value: 'p' }]);
    expect(right.measures[0].events[1]?.dynamics).toBeUndefined();
    // 下段: staff=2 指定の f が付き、staff=1 の p は混入しない
    expect(left.measures[0].events[0].dynamics).toEqual([{ value: 'f' }]);
  });

  it('声部3では松葉を復元しない（round2 P2: 小節またぎで壊れた松葉を作らない）', () => {
    // 声部3に <wedge> がある（自分の書き出しでは作らないが外部ファイルではあり得る）
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>M</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><type>whole</type><voice>1</voice></note>
      <backup><duration>16</duration></backup>
      <note><rest/><duration>16</duration><type>whole</type><voice>2</voice></note>
      <backup><duration>16</duration></backup>
      <direction><direction-type><wedge type="crescendo"/></direction-type></direction>
      <direction placement="below"><direction-type><dynamics><f/></dynamics></direction-type></direction>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>whole</type><voice>3</voice></note>
    </measure>
  </part>
</score-partwise>`;
    const imported = parseMusicXml(xml);
    const v3 = imported.parts[0].measures[0].voices?.[2]?.events?.[0];
    // 文字強弱は復元し、松葉は付かない
    expect(v3?.dynamics).toEqual([{ value: 'f' }]);
    expect(v3?.hairpins).toBeUndefined();
  });
});
