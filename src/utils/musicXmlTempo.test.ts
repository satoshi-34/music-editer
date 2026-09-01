// src/utils/musicXmlTempo.test.ts
// テンポ（全体テンポ・小節ごとの数値テンポ変更・速度標語）が MusicXML の
// export/import で往復するかを確認するテスト（Issue #518）。
//
// 以前は全体テンポ（再生パネルの ♩=N）がどこにも書き出されず、
// 書き出し→読み込みで既定の 120 に戻ってしまっていた。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml, parseMusicXmlWithDefaults } from './musicXmlImport';
import type { MeasureData, SavedScoreData } from '../types/storage';

/** テスト用の単旋律スコアを作る小さなヘルパー */
function makeScore(measures: MeasureData[]): SavedScoreData {
  return createSavedScoreData(
    { title: 'Tempo Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures }],
    1,
    measures.length,
    'single',
    'C'
  );
}

const oneNoteMeasure = (): MeasureData => ({ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] });

describe('MusicXML の全体テンポ（♩=N）', () => {
  it('globalBpm を渡すと先頭小節に <sound tempo> と <metronome> が出力される', () => {
    const xml = scoreToMusicXml(makeScore([oneNoteMeasure(), oneNoteMeasure()]), { globalBpm: 126 });

    const measure1 = xml.match(/<measure number="1">(.*?)<\/measure>/s)?.[1] ?? '';
    expect(measure1).toContain('<sound tempo="126"/>');
    expect(measure1).toContain('<per-minute>126</per-minute>');
    // 2小節目にはテンポ指定が無いので出さない（全体テンポは先頭小節にだけ書く）
    const measure2 = xml.match(/<measure number="2">(.*?)<\/measure>/s)?.[1] ?? '';
    expect(measure2).not.toContain('<sound tempo=');
  });

  it('export → import で全体テンポが globalBpm として保たれる（既定の 120 に戻らない）', () => {
    const xml = scoreToMusicXml(makeScore([oneNoteMeasure(), oneNoteMeasure()]), { globalBpm: 126 });
    const imported = parseMusicXmlWithDefaults(xml);

    // 先頭小節の単独 <sound tempo> は「全体テンポ」として別枠で返す（round1 P1）。
    // measure.bpm（小節ごとの数値テンポ変更）へは入れない — 入れると再書き出しで
    // 「全体テンポ」が「先頭小節の数値変更」へ意味が変わってしまう
    expect(imported.globalBpm).toBe(126);
    expect(imported.score.parts[0].measures[0].bpm).toBeUndefined();
  });

  it('globalBpm を渡さない書き出しは従来どおりテンポを出さない（回帰）', () => {
    const xml = scoreToMusicXml(makeScore([oneNoteMeasure()]));
    expect(xml).not.toContain('<sound tempo=');
    expect(xml).not.toContain('<metronome>');
  });

  it('小節ごとの数値テンポ変更は全体テンポより優先して出力される', () => {
    const measures = [oneNoteMeasure(), { ...oneNoteMeasure(), bpm: 90 }];
    const xml = scoreToMusicXml(makeScore(measures), { globalBpm: 126 });

    const measure1 = xml.match(/<measure number="1">(.*?)<\/measure>/s)?.[1] ?? '';
    const measure2 = xml.match(/<measure number="2">(.*?)<\/measure>/s)?.[1] ?? '';
    expect(measure1).toContain('<sound tempo="126"/>');
    expect(measure2).toContain('<sound tempo="90"/>');

    const imported = parseMusicXmlWithDefaults(xml);
    expect(imported.globalBpm).toBe(126);
    expect(imported.score.parts[0].measures[0].bpm).toBeUndefined();
    expect(imported.score.parts[0].measures[1].bpm).toBe(90);
  });
});

describe('MusicXML の速度標語（Andante 等）', () => {
  it('速度標語は <words> と目安 BPM の <sound tempo> で出力される', () => {
    const measures: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['c/4'], tempoMarking: 'Andante' }] },
    ];
    const xml = scoreToMusicXml(makeScore(measures));

    expect(xml).toContain('<words>Andante</words>');
    // tempoMarkingPresets の Andante = 76
    expect(xml).toContain('<sound tempo="76"/>');
  });

  it('対応表に無い自由入力は <words> だけを出し、テンポを主張しない', () => {
    const measures: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['c/4'], tempoMarking: 'Allegro con brio' }] },
    ];
    const xml = scoreToMusicXml(makeScore(measures));

    expect(xml).toContain('<words>Allegro con brio</words>');
    expect(xml).not.toContain('<sound tempo=');
  });

  it('export → import で速度標語が復元される', () => {
    const measures: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['c/4'], tempoMarking: 'Andante' }] },
      oneNoteMeasure(),
    ];
    const xml = scoreToMusicXml(makeScore(measures));
    const imported = parseMusicXml(xml);

    expect(imported.parts[0].measures[0].events[0].tempoMarking).toBe('Andante');
    expect(imported.parts[0].measures[1].events[0].tempoMarking).toBeUndefined();
  });

  it('標語に併記した <sound tempo> は数値テンポ変更として取り込まない（round1 P1）', () => {
    const measures: MeasureData[] = [
      oneNoteMeasure(),
      { events: [{ dur: '4', isRest: false, keys: ['c/4'], tempoMarking: 'Andante' }] },
    ];
    const xml = scoreToMusicXml(makeScore(measures));
    const imported = parseMusicXmlWithDefaults(xml);

    // 2小節目は「標語 Andante」だけが復元され、目安 BPM の 76 は measure.bpm に入らない。
    // 入ってしまうと数値優先の規則（#516）で、以後標語を書き替えても 76 のまま鳴る
    expect(imported.score.parts[0].measures[1].events[0].tempoMarking).toBe('Andante');
    expect(imported.score.parts[0].measures[1].bpm).toBeUndefined();
    expect(imported.globalBpm).toBeUndefined();
  });

  it('全体テンポと先頭小節の標語が共存しても往復で意味が変わらない（round1 P1）', () => {
    const measures: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['c/4'], tempoMarking: 'Andante' }] },
    ];
    const xml = scoreToMusicXml(makeScore(measures), { globalBpm: 126 });
    const imported = parseMusicXmlWithDefaults(xml);

    expect(imported.globalBpm).toBe(126);
    expect(imported.score.parts[0].measures[0].events[0].tempoMarking).toBe('Andante');
    expect(imported.score.parts[0].measures[0].bpm).toBeUndefined();
  });

  it('先頭小節に数値テンポ変更と標語が共存しても往復で優先順位が変わらない（round2 P1）', () => {
    const measures: MeasureData[] = [
      { bpm: 126, events: [{ dur: '4', isRest: false, keys: ['c/4'], tempoMarking: 'Andante' }] },
    ];
    const xml = scoreToMusicXml(makeScore(measures), { globalBpm: 120 });
    // 全体テンポの正本はアプリ固有メタに記録される
    expect(xml).toContain('<miscellaneous-field name="music-editer.global-bpm">120</miscellaneous-field>');
    const imported = parseMusicXmlWithDefaults(xml);

    // メタ（120）と先頭小節の数値（126）が食い違う＝126は本物の数値テンポ変更なので保持。
    // 読み替えてしまうと優先順位が「数値 > 標語」から「標語 > 全体」へ反転し、
    // 実効テンポが 126 → 76 に変わってしまう
    expect(imported.globalBpm).toBe(120);
    expect(imported.score.parts[0].measures[0].bpm).toBe(126);
    expect(imported.score.parts[0].measures[0].events[0].tempoMarking).toBe('Andante');
  });

  it('全体テンポと同値の明示テンポ変更が先頭小節にあっても消えない（round4 P1）', () => {
    const measures: MeasureData[] = [
      { bpm: 120, events: [{ dur: '4', isRest: false, keys: ['c/4'], tempoMarking: 'Andante' }] },
    ];
    const xml = scoreToMusicXml(makeScore(measures), { globalBpm: 120 });
    // 由来メタが「先頭小節の数値は明示」と記録する
    expect(xml).toContain('<miscellaneous-field name="music-editer.first-measure-bpm-explicit">0</miscellaneous-field>');
    const imported = parseMusicXmlWithDefaults(xml);

    // 値が全体テンポと同じ 120 でも明示の数値変更は保持される。
    // 消すと実効テンポが「数値120」から「標語76」へ反転してしまう
    expect(imported.globalBpm).toBe(120);
    expect(imported.score.parts[0].measures[0].bpm).toBe(120);
  });

  it('不正な global-bpm メタは「メタ無し」扱いにせず読み替えを行わない（round4 P2）', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <identification><miscellaneous><miscellaneous-field name="music-editer.global-bpm">120abc</miscellaneous-field></miscellaneous></identification>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>126</per-minute></metronome></direction-type><sound tempo="126"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const imported = parseMusicXmlWithDefaults(xml);

    expect(imported.globalBpm).toBeUndefined();
    expect(imported.score.parts[0].measures[0].bpm).toBe(126);
  });

  it('#422 の記号表示メタと global-bpm メタが同じ miscellaneous に併存して往復する', () => {
    const score = makeScore([oneNoteMeasure()]);
    const xml = scoreToMusicXml({ ...score, timeSignature: [2, 2], timeSignatureStyle: 'symbol' }, { globalBpm: 126 });

    // 文字列の存在だけでなく「同一の <miscellaneous> 要素の子」であることを DOM で固定する
    //（別々の <miscellaneous> に分かれると XML スキーマ違反になる・round5 P3）
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const fields = Array.from(doc.querySelectorAll('identification miscellaneous-field'));
    const styleField = fields.find((el) => el.getAttribute('name') === 'music-editer.time-signature-style');
    const bpmField = fields.find((el) => el.getAttribute('name') === 'music-editer.global-bpm');
    expect(styleField?.textContent).toBe('symbol');
    expect(bpmField?.textContent).toBe('126');
    expect(doc.querySelectorAll('identification miscellaneous').length).toBe(1);
    expect(styleField?.parentElement).toBe(bpmField?.parentElement);
    const imported = parseMusicXmlWithDefaults(xml);
    expect(imported.globalBpm).toBe(126);
    expect(imported.score.timeSignatureStyle).toBe('symbol');
  });

  it('明示ありと無しのパートが混在しても、明示側だけが保持される（round5 P1）', () => {
    const score = createSavedScoreData(
      { title: '混在', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [
        { partId: 'p1', clef: 'treble', measures: [oneNoteMeasure()] },
        { partId: 'p2', clef: 'treble', measures: [{ ...oneNoteMeasure(), bpm: 126 }] },
      ],
      1, 1, 'single', 'C'
    );
    const xml = scoreToMusicXml(score, { globalBpm: 120 });
    expect(xml).toContain('<miscellaneous-field name="music-editer.first-measure-bpm-explicit">1</miscellaneous-field>');
    const imported = parseMusicXmlWithDefaults(xml);

    // P1（明示なし）は全体テンポ由来の 120 が取り除かれ、P2（明示 126）は保持される。
    // 両方残ると先勝ちで 120 が選ばれ、本来の 126 から変わってしまう
    expect(imported.globalBpm).toBe(120);
    expect(imported.score.parts[0].measures[0].bpm).toBeUndefined();
    expect(imported.score.parts[1].measures[0].bpm).toBe(126);
  });

  it('明示値が全体テンポと同値でも、番号リストのパートだけが保持される（round6 P3）', () => {
    const score = createSavedScoreData(
      { title: '同値混在', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [
        { partId: 'p1', clef: 'treble', measures: [oneNoteMeasure()] },
        { partId: 'p2', clef: 'treble', measures: [{ ...oneNoteMeasure(), bpm: 120 }] },
      ],
      1, 1, 'single', 'C'
    );
    const xml = scoreToMusicXml(score, { globalBpm: 120 });
    const imported = parseMusicXmlWithDefaults(xml);

    // 値がどちらも 120 なので、番号リストを無視して値比較だけにすると P2 側も消えてしまう
    expect(imported.globalBpm).toBe(120);
    expect(imported.score.parts[0].measures[0].bpm).toBeUndefined();
    expect(imported.score.parts[1].measures[0].bpm).toBe(120);
  });

  it('本文の <part> 順が part-list と逆でも、番号リストは part-list 順で照合される（round6 P2）', () => {
    // part-list は P1→P2、本文は P2→P1。明示リスト「1」は part-list 上の2番目 = P2 を指す
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <identification><miscellaneous><miscellaneous-field name="music-editer.global-bpm">120</miscellaneous-field><miscellaneous-field name="music-editer.first-measure-bpm-explicit">1</miscellaneous-field></miscellaneous></identification>
  <part-list>
    <score-part id="P1"><part-name>A</part-name></score-part>
    <score-part id="P2"><part-name>B</part-name></score-part>
  </part-list>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const imported = parseMusicXmlWithDefaults(xml);

    // 文書順の番号で照合すると P2（本文1番目=番号0）の明示が消え、P1 が残る逆転が起きる
    const p2 = imported.score.parts.find((p) => p.partId === 'B') ?? imported.score.parts[0];
    const p1 = imported.score.parts.find((p) => p.partId === 'A') ?? imported.score.parts[1];
    expect(imported.globalBpm).toBe(120);
    expect(p2.measures[0].bpm).toBe(120);
    expect(p1.measures[0].bpm).toBeUndefined();
  });

  it('旧形式の明示メタ true は全パート一律の保持として受理される（後方互換）', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <identification><miscellaneous><miscellaneous-field name="music-editer.global-bpm">120</miscellaneous-field><miscellaneous-field name="music-editer.first-measure-bpm-explicit">true</miscellaneous-field></miscellaneous></identification>
  <part-list><score-part id="P1"><part-name>A</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const imported = parseMusicXmlWithDefaults(xml);
    expect(imported.globalBpm).toBe(120);
    expect(imported.score.parts[0].measures[0].bpm).toBe(120);
  });

  it('五線分割される大譜表でも明示メタが両段に効く', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <identification><miscellaneous><miscellaneous-field name="music-editer.global-bpm">120</miscellaneous-field><miscellaneous-field name="music-editer.first-measure-bpm-explicit">0</miscellaneous-field></miscellaneous></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const imported = parseMusicXmlWithDefaults(xml);
    expect(imported.globalBpm).toBe(120);
    // 分割後の右手・左手の両方が「明示パート由来」として保持される
    expect(imported.score.parts.every((p) => p.measures[0].bpm === 120)).toBe(true);
  });

  it('part-list に余分な score-part があるときは全パート文書順へフォールバックする（round8/9）', () => {
    // part-list=[P1,PX,P2]・本文=[P1,P2]。part-list 順だと P2 が番号2になり明示リスト「1」と
    // 照合できない。不整合ファイルでは全パートを文書順（P1=0, P2=1）で照合する
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <identification><miscellaneous><miscellaneous-field name="music-editer.global-bpm">120</miscellaneous-field><miscellaneous-field name="music-editer.first-measure-bpm-explicit">1</miscellaneous-field></miscellaneous></identification>
  <part-list>
    <score-part id="P1"><part-name>A</part-name></score-part>
    <score-part id="PX"><part-name>X</part-name></score-part>
    <score-part id="P2"><part-name>B</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const imported = parseMusicXmlWithDefaults(xml);
    // 文書順フォールバック: 明示「1」= 本文2番目の P2 が保持され、P1 は除去される
    expect(imported.globalBpm).toBe(120);
    expect(imported.score.parts[0].measures[0].bpm).toBeUndefined();
    expect(imported.score.parts[1].measures[0].bpm).toBe(120);
  });

  it('part-list の id が重複しているときも全パート文書順へフォールバックする（round9）', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <identification><miscellaneous><miscellaneous-field name="music-editer.global-bpm">120</miscellaneous-field><miscellaneous-field name="music-editer.first-measure-bpm-explicit">1</miscellaneous-field></miscellaneous></identification>
  <part-list>
    <score-part id="P1"><part-name>A</part-name></score-part>
    <score-part id="P1"><part-name>B</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const imported = parseMusicXmlWithDefaults(xml);
    expect(imported.globalBpm).toBe(120);
    expect(imported.score.parts[0].measures[0].bpm).toBeUndefined();
    expect(imported.score.parts[1].measures[0].bpm).toBe(120);
  });

  it('メタの無い外部ファイルでも、標語より後の単独 <sound> は数値変更として保持する', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="above"><direction-type><words>Andante</words></direction-type><sound tempo="76"/></direction>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>126</per-minute></metronome></direction-type><sound tempo="126"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const imported = parseMusicXmlWithDefaults(xml);

    // 外部プレーヤーでは後に書かれた 126 が鳴る。全体テンポへ読み替えると
    // 標語（76）が勝つ側へ反転するので、数値のまま保持する
    expect(imported.globalBpm).toBeUndefined();
    expect(imported.score.parts[0].measures[0].bpm).toBe(126);
  });

  it('複数パートで先頭小節のテンポが食い違うときは globalBpm へ統合しない（round2 P2）', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>A</part-name></score-part>
    <score-part id="P2"><part-name>B</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type><sound tempo="100"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>140</per-minute></metronome></direction-type><sound tempo="140"/></direction>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const imported = parseMusicXmlWithDefaults(xml);

    expect(imported.globalBpm).toBeUndefined();
    expect(imported.score.parts[0].measures[0].bpm).toBe(100);
    expect(imported.score.parts[1].measures[0].bpm).toBe(140);
  });

  it('発想標語の後にある速度標語も取り込める（round1 P2: 最初の <words> で止まらない）', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="above"><direction-type><words>dolce</words></direction-type></direction>
      <direction placement="above"><direction-type><words>Andante</words></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;
    const imported = parseMusicXml(xml);
    expect(imported.parts[0].measures[0].events[0].tempoMarking).toBe('Andante');
  });

  it('小節途中の音符に付けた標語は同じ位置へ往復する（round1 P2）', () => {
    const measures: MeasureData[] = [
      { events: [
        { dur: '4', isRest: false, keys: ['c/4'] },
        { dur: '4', isRest: false, keys: ['d/4'] },
        { dur: '4', isRest: false, keys: ['e/4'], tempoMarking: 'Allegro' },
        { dur: '4', isRest: false, keys: ['f/4'] },
      ] },
    ];
    const xml = scoreToMusicXml(makeScore(measures));
    const imported = parseMusicXml(xml);

    const evs = imported.parts[0].measures[0].events;
    expect(evs[0].tempoMarking).toBeUndefined();
    expect(evs[2].tempoMarking).toBe('Allegro');
  });

  it('追加声部（声部2）の標語も書き出される（round1 P2）', () => {
    const measures: MeasureData[] = [
      {
        events: [{ dur: '4', isRest: false, keys: ['c/5'] }],
        voices: [
          { id: 'voice-1', events: [{ dur: '4', isRest: false, keys: ['c/5'] }] },
          { id: 'voice-2', events: [{ dur: '4', isRest: false, keys: ['e/4'], tempoMarking: 'Vivace' }], stemDirection: 'down' as const },
        ],
      },
    ];
    const xml = scoreToMusicXml(makeScore(measures));
    expect(xml).toContain('<words>Vivace</words>');
  });

  it('速度標語ではない <words>（発想標語など）は取り込まない', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="above"><direction-type><words>dolce</words></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;
    const imported = parseMusicXml(xml);
    expect(imported.parts[0].measures[0].events[0].tempoMarking).toBeUndefined();
  });
});
