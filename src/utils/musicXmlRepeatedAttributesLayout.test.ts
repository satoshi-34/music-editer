// src/utils/musicXmlRepeatedAttributesLayout.test.ts
// Issue #526: 連符を含む MusicXML を読み込むと段割りが1小節/段へ膨張する問題の回帰テスト。
//
// 原因は連符そのものではなく、**変更が無いのに毎小節 <attributes> を書き直す書き出し元**
// （Finale など外部ソフトの定番の書き方）を「小節ごとの調号変更・拍子変更」として
// 取り込んでいたこと。段割りの計画（measurePlannerSafetyPadding）は
// 「調号が描かれる小節は +42、拍子が描かれる小節は +30」を**パートごとに**上乗せするため、
// 大譜表（2パート）では1小節あたり +144 も水増しされ、1段に入る小節数が不当に減っていた。
// 描画側（PianoSystemCanvas）は前の小節と比べて変わったときだけ記号を出すので、
// 「描かれないのに幅だけ確保する」という食い違いになっていた。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseMusicXml, parseMusicXmlWithDefaults } from './musicXmlImport';
import { scoreToMusicXml } from './musicXmlExport';
import {
  planEffectiveMeasuresPerSystem,
  planSystemMeasureRanges,
  worstCaseSystemContentBudget,
  SCORE_LAYOUT_RENDER_SCALE,
} from './measureLayoutUtils';
import type { SavedScoreData } from '../types/storage';

/** ピアノ譜の既定「音符の大きさ」150%。読込直後の段割りはこの倍率で決まる。 */
const PIANO_NOTATION_SIZE_MULTIPLIER = 1.5;

const DIRECT_FIXTURE_PATH = resolve(__dirname, '../../docs/qa/regression/moonlight-bars1-9.score.json');
const XML_FIXTURE_PATH = resolve(__dirname, '../../docs/qa/regression/moonlight-bars1-9-grandstaff.musicxml');

type LayoutParts = { measures: SavedScoreData['parts'][number]['measures']; clef: SavedScoreData['parts'][number]['clef'] }[];

/**
 * 段割りの計画（1段あたりの小節数と、各小節の最低幅）を求める。
 * ScorePage が読込直後にしているのと同じ組み合わせ（既定余白14mm・A4・楽器名なし）。
 */
function planLayout(parts: LayoutParts, timeSignature: [number, number], keySignature: SavedScoreData['keySignature']) {
  const budget = worstCaseSystemContentBudget(14, 0, 210);
  const renderScale = SCORE_LAYOUT_RENDER_SCALE * PIANO_NOTATION_SIZE_MULTIPLIER;
  const plan = planEffectiveMeasuresPerSystem(
    parts.map((part) => ({ measures: part.measures, keySignatureMeasures: parts[0].measures, clef: part.clef })),
    timeSignature,
    keySignature,
    4,
    budget,
    renderScale,
    {},
  );
  // 内容のある9小節までを段へ割り付ける（末尾の空小節は段割りの比較対象にしない）
  const ranges = planSystemMeasureRanges(plan.minimumWidths, 4, budget / renderScale, 9);
  return {
    effectiveMeasuresPerSystem: plan.effectiveMeasuresPerSystem,
    widths: plan.minimumWidths.map((width) => Math.round(width)),
    measuresPerSystem: ranges.map((range) => range.count),
  };
}

/** 1パート・n小節の最小限の MusicXML。各小節の <attributes> の中身を呼び出し側が決める。 */
function xmlWithMeasureAttributes(measureAttributes: (index: number) => string, measureCount = 4): string {
  const measures = Array.from({ length: measureCount }, (_, i) => `
    <measure number="${i + 1}">
      ${measureAttributes(i)}
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    </measure>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">${measures}</part>
</score-partwise>`;
}

const FULL_ATTRIBUTES = `<attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>`;

describe('MusicXML: 変更の無い <attributes> の書き直しを段割りへ持ち込まない（#526）', () => {
  it('毎小節 <key>・<time> を書き直したファイルでも、2小節目以降に調号変更・拍子変更を作らない', () => {
    const score = parseMusicXml(xmlWithMeasureAttributes(() => FULL_ATTRIBUTES));
    const measures = score.parts[0].measures;

    expect(measures).toHaveLength(4);
    // 先頭小節を含め、どの小節にも「この小節で変わる」印を付けない
    // （曲全体の調号・拍子は SavedScoreData 側が持っている）
    expect(measures.map((m) => m.keySignature)).toEqual([undefined, undefined, undefined, undefined]);
    expect(measures.map((m) => m.timeSignature)).toEqual([undefined, undefined, undefined, undefined]);
    expect(score.keySignature).toBe('C');
    expect(score.timeSignature).toEqual([4, 4]);
  });

  it('本当に変わる小節では従来どおり調号変更・拍子変更として取り込む', () => {
    const score = parseMusicXml(xmlWithMeasureAttributes((i) => {
      if (i === 0) return FULL_ATTRIBUTES;
      // 3小節目でだけ ト長調（fifths=1）・3/4 へ変わる。4小節目は同じ内容の書き直し
      if (i >= 2) {
        return `<attributes>
          <key><fifths>1</fifths></key>
          <time><beats>3</beats><beat-type>4</beat-type></time>
        </attributes>`;
      }
      return FULL_ATTRIBUTES;
    }));
    const measures = score.parts[0].measures;

    expect(measures[1].keySignature).toBeUndefined();
    expect(measures[2].keySignature).toBe('G');
    expect(measures[2].timeSignature).toEqual([3, 4]);
    // 4小節目は「同じ内容の書き直し」なので変更として取り込まない
    expect(measures[3].keySignature).toBeUndefined();
    expect(measures[3].timeSignature).toBeUndefined();
  });

  it('受入条件1: 月光（大譜表・毎小節 attributes）を読み込んだ段割りが、同内容を直接入力した場合と一致する', () => {
    const direct = JSON.parse(readFileSync(DIRECT_FIXTURE_PATH, 'utf-8')) as SavedScoreData;
    const imported = parseMusicXmlWithDefaults(readFileSync(XML_FIXTURE_PATH, 'utf-8')).score;

    // 読み込み結果は同じピアノ大譜表（右手ト音・左手ヘ音）
    expect(imported.scoreType).toBe('piano');
    expect(imported.parts.map((part) => part.clef)).toEqual(['treble', 'bass']);

    const directPlan = planLayout(direct.parts, direct.timeSignature as [number, number], direct.keySignature);
    const importedPlan = planLayout(imported.parts, imported.timeSignature as [number, number], imported.keySignature);

    // 受入条件1: 「全部の段が1小節」ではなくなっている（修正前は最低幅の水増しで1小節/段まで縮んでいた）。
    //
    // 期待値の更新（Issue #559・2026-09-03）: 以前は「すべての段が2小節以上」で固定していたが、
    // #559 で最低幅の過大見積もりを直した結果、内容9小節の詰まり方が 3,3,3 から 4,4,1 になった。
    // 末尾の「1」は幅が足りないのではなく、9小節を4小節ずつ詰めた余り（内容の最後で段を
    // 打ち切る breakAt=9 の既存挙動）なので、条件を「余りの段以外は2小節以上」へ改めた。
    const contentCounts = importedPlan.measuresPerSystem.slice(
      0,
      // 内容9小節ぶんの段だけを見る（それ以降は編集用の空きバッファの段）
      importedPlan.measuresPerSystem.reduce(
        (acc, count) => (acc.total >= 9 ? acc : { total: acc.total + count, systems: acc.systems + 1 }),
        { total: 0, systems: 0 },
      ).systems,
    );
    expect(contentCounts.reduce((sum, count) => sum + count, 0)).toBe(9);
    expect(contentCounts.slice(0, -1).every((count) => count >= 2)).toBe(true);
    // 直接入力と同じ段割りになる
    expect(importedPlan.measuresPerSystem).toEqual(directPlan.measuresPerSystem);
    // 入力済み9小節のうち、書き出し→読込で形が変わらない1〜8小節目は最低幅も一致する
    // （9小節目だけは連符IDの交錯という fixture 既知の傷の直し方が経路で異なるため除く。
    //   docs/qa/regression/README.md の「既知の入力上の傷3」参照）
    expect(importedPlan.widths.slice(0, 8)).toEqual(directPlan.widths.slice(0, 8));
  });

  it('受入条件2: 連符なしのファイルは、attributes の書き直しがあってもなくても同じ段割りになる', () => {
    const repeated = parseMusicXml(xmlWithMeasureAttributes(() => FULL_ATTRIBUTES, 8));
    const once = parseMusicXml(xmlWithMeasureAttributes((i) => (i === 0 ? FULL_ATTRIBUTES : ''), 8));

    const repeatedPlan = planLayout(repeated.parts, repeated.timeSignature as [number, number], repeated.keySignature);
    const oncePlan = planLayout(once.parts, once.timeSignature as [number, number], once.keySignature);

    expect(repeatedPlan.widths).toEqual(oncePlan.widths);
    expect(repeatedPlan.measuresPerSystem).toEqual(oncePlan.measuresPerSystem);
    expect(repeatedPlan.effectiveMeasuresPerSystem).toBe(oncePlan.effectiveMeasuresPerSystem);
  });

  it('途中拍子変更が往復で継続する（round1 P1: 4/4→3/4→3/4→4/4）', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>M</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>12</duration><type>half</type><dot/></note>
    </measure>
    <measure number="3">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>12</duration><type>half</type><dot/></note>
    </measure>
    <measure number="4">
      <attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const first = parseMusicXml(xml);
    // 正規化: 変わった小節だけ印が残る
    expect(first.parts[0].measures.map((m) => m.timeSignature ?? null)).toEqual([
      null, [3, 4], null, [4, 4],
    ]);

    // 書き出し→再読み込みで同じ形に戻る（3小節目に誤った 4/4 が生えない）
    const rexml = scoreToMusicXml(first);
    const second = parseMusicXml(rexml);
    expect(second.parts[0].measures.map((m) => m.timeSignature ?? null)).toEqual([
      null, [3, 4], null, [4, 4],
    ]);
  });
});
