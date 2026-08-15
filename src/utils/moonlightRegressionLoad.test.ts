// Issue #243: 月光1〜9小節の実機入力データ（docs/qa/regression/moonlight-bars1-9.score.json）を
// 機械で回す回帰チェックの「読込」担当。
//
// なぜ必要か: #237（発想標語が描画されない）・#240（BPM下限）は「機能を単体で作り、
// 実曲で一度も使わない」ことで見逃された。実機で入力された1曲を毎回のテストに通して
// おけば、この手の移植漏れがCIで止まる。
//
// このファイルが固定するのは「ファイルを開く経路（importScoreFromFile）を通したあとの
// データの形」だけ。描画は MoonlightRegressionRender.test.tsx、再生スケジュールは
// moonlightRegressionPlayback.test.ts が担当する。
//
// 期待値はすべて fixture から機械抽出した実測値をそのまま定数化してある。
// fixture は読み取り専用（このテストは書き換えない）。README に記載の「既知の入力上の傷」も
// 直さずそのまま期待値に織り込む（意図的に残したバグ再現データのため）。
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { MeasureData, NoteEvent, SavedScoreData } from '../types/storage';
import { importScoreFromFile } from './fileStorage';
import { getMeasureVoices } from './voiceMeasureUtils';

const FIXTURE_PATH = resolve(__dirname, '../../docs/qa/regression/moonlight-bars1-9.score.json');

function readFixtureText(): string {
  return readFileSync(FIXTURE_PATH, 'utf-8');
}

/** アプリの「その他 → ファイルを開く」と同じ経路（File → importScoreFromFile）で読み込む。 */
function loadViaImport(): Promise<SavedScoreData> {
  const file = new File([readFixtureText()], 'moonlight-bars1-9.score.json', {
    type: 'application/json',
  });
  return importScoreFromFile(file);
}

/**
 * 小節の「実体としての声部」を取り出す。
 * 声部2を使っていない小節は voices を持たず measure.events だけなので、
 * getMeasureVoices が単一声部として返してくれる。
 */
function voiceEventLists(measure: MeasureData): NoteEvent[][] {
  return getMeasureVoices(measure).map((voice) => voice.events);
}

function allEvents(measure: MeasureData): NoteEvent[] {
  return voiceEventLists(measure).flat();
}

/** 連符（3連符など）のグループ数。同じ id を共有するイベントが1グループ。 */
function tupletGroupCount(measure: MeasureData): number {
  return voiceEventLists(measure).reduce((sum, events) => {
    const ids = new Set(events.filter((ev) => ev.tuplet).map((ev) => ev.tuplet!.id));
    return sum + ids.size;
  }, 0);
}

// ---- fixture から機械抽出した期待値（2026-08-14 時点の実測値） ----

const EXPECTED_PART_IDS = ['right-hand', 'left-hand'];
const EXPECTED_CLEFS = ['treble', 'bass'];
/** 13小節ぶんの器がある（9小節ぶん入力済み＋末尾4小節は空）。 */
const EXPECTED_MEASURE_COUNT = 13;
/** 右手・左手それぞれの「小節ごとの総イベント数（全声部合計）」。 */
const EXPECTED_EVENTS_PER_MEASURE = [
  [12, 12, 12, 12, 16, 15, 14, 15, 13, 0, 0, 0, 0],
  [1, 1, 4, 4, 2, 1, 2, 3, 1, 0, 0, 0, 0],
];
/** 小節ごとの声部数。2 の小節が「2声部で書かれた小節」。 */
const EXPECTED_VOICES_PER_MEASURE = [
  [1, 1, 1, 1, 2, 2, 2, 2, 2, 1, 1, 1, 1],
  [1, 1, 2, 2, 2, 1, 1, 2, 1, 1, 1, 1, 1],
];
/** 小節ごとの連符グループ数。右手は全小節「4グループ（=3連符×4）」で揃う。 */
const EXPECTED_TUPLET_GROUPS_PER_MEASURE = [
  [4, 4, 4, 4, 4, 4, 4, 4, 4, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];

/** fixture の SHA-256（docs/qa/regression/README.md に記載のものと同一）。 */
const EXPECTED_FIXTURE_SHA256 =
  '1beb6b3d246a13d24c8b1f5ddf8cd37ea37a29e3af5d77811c6ed3c94bfc5d8b';

/** 1小節目の音高列。バイト単位の書き換えを「意味のある形」で検知するための見張り。 */
const EXPECTED_BAR1_RIGHT_HAND_KEYS = [
  ['g#/3'], ['c#/4'], ['e/4'],
  ['g#/3'], ['c#/4'], ['e/4'],
  ['g#/3'], ['c#/4'], ['e/4'],
  ['g#/3'], ['c#/4'], ['e/4'],
];
const EXPECTED_BAR1_LEFT_HAND_KEYS = [['c#/2', 'c#/3']];

describe('月光1〜9小節 回帰チェック: 読込（Issue #243）', () => {
  it('fixture が1バイトも変わっていない（意図せぬ書き換えの検知）', () => {
    // この fixture は「実機で入力されたそのままの姿」に価値があり、
    // 既知の傷ごと固定しておく約束になっている（docs/qa/regression/README.md）。
    // 件数や構造だけを見ていると音高の書き換えのような変更を素通ししてしまうので、
    // ファイル全体のハッシュで「1バイトでも変わったら落ちる」状態にしておく。
    const sha256 = createHash('sha256').update(readFileSync(FIXTURE_PATH)).digest('hex');
    expect(sha256).toBe(EXPECTED_FIXTURE_SHA256);
  });

  it('1小節目の音高が両手とも実機入力どおり（ハッシュが落ちたとき何が変わったか分かるように）', async () => {
    const data = await loadViaImport();
    const rightHand = data.parts[0].measures as MeasureData[];
    const leftHand = data.parts[1].measures as MeasureData[];

    expect(allEvents(rightHand[0]).map((ev) => ev.keys)).toEqual(EXPECTED_BAR1_RIGHT_HAND_KEYS);
    expect(allEvents(leftHand[0]).map((ev) => ev.keys)).toEqual(EXPECTED_BAR1_LEFT_HAND_KEYS);
    // 1音目にテンポ表記・発想標語・運指・記号位置調整がまとめて載っている（#237 の再発検知点）。
    expect(rightHand[0].events[0].tempoMarking).toBe('Adagio sostenuto');
    expect(rightHand[0].events[0].expressionMarking).toContain('Si deve suonare');
    expect(rightHand[0].events[0].fingering).toBe('1');
  });

  it('ファイルを開く経路（importScoreFromFile）でパースでき、譜面全体の設定が期待どおり', async () => {
    const data = await loadViaImport();

    expect(data.version).toBe('3.5.0');
    expect(data.scoreType).toBe('piano');
    expect(data.keySignature).toBe('E');
    expect(data.timeSignature).toEqual([4, 4]);
    expect(data.notationMode).toBe('concert');
    expect(data.instrumentation?.presetId).toBe('piano');

    // 段あたり小節数のオーバーライド（3小節×3段）。実機で操作した設定がそのまま残っている。
    expect(data.systemMeasureOverrides).toEqual([
      { startMeasure: 0, count: 3 },
      { startMeasure: 3, count: 3 },
      { startMeasure: 6, count: 3 },
    ]);
    expect(data.measuresPerSystem).toBe(4);
    expect(data.systems).toBe(12);
    // 記号エディタで作ったカスタム記号は使っていない譜面。
    expect(data.customSymbolDefs).toEqual([]);
  });

  it('パート構成・小節数・声部数・イベント数・連符グループ数が一致する', async () => {
    const data = await loadViaImport();

    expect(data.parts.map((part) => part.partId)).toEqual(EXPECTED_PART_IDS);
    expect(data.parts.map((part) => part.clef)).toEqual(EXPECTED_CLEFS);

    data.parts.forEach((part, pi) => {
      const measures = part.measures as MeasureData[];
      expect(measures).toHaveLength(EXPECTED_MEASURE_COUNT);
      expect(measures.map((m) => allEvents(m).length)).toEqual(EXPECTED_EVENTS_PER_MEASURE[pi]);
      expect(measures.map((m) => voiceEventLists(m).length)).toEqual(EXPECTED_VOICES_PER_MEASURE[pi]);
      expect(measures.map(tupletGroupCount)).toEqual(EXPECTED_TUPLET_GROUPS_PER_MEASURE[pi]);
    });
  });

  it('スラー3本の張り先（小節内2本＋小節またぎ1本）と、記号・運指・付点の件数が一致する', async () => {
    const data = await loadViaImport();

    // 弧（タイ／スラー）は始点イベントの arcs[] に載る。どこからどこへ張られているかまで固定する。
    const arcs = data.parts.flatMap((part, pi) =>
      (part.measures as MeasureData[]).flatMap((measure, mi) =>
        allEvents(measure).flatMap((ev, ei) =>
          (ev.arcs ?? []).map((arc) => ({ pi, mi, ei, arc }))
        )
      )
    );
    expect(arcs).toHaveLength(3);
    expect(arcs.every(({ arc }) => arc.kind === 'slur')).toBe(true);
    // 3小節目（index 2）の中で完結する2本。
    expect(arcs[0]).toMatchObject({ pi: 0, mi: 2, ei: 0, arc: { toMeasureIndex: 2, toEventIndex: 5 } });
    expect(arcs[1]).toMatchObject({ pi: 0, mi: 2, ei: 6, arc: { toMeasureIndex: 2, toEventIndex: 11 } });
    // 7→8小節（index 6→7）の小節またぎ。制御点オフセット付きで保存されている。
    expect(arcs[2]).toMatchObject({ pi: 0, mi: 6, ei: 0, arc: { toMeasureIndex: 7, toEventIndex: 2 } });
    expect(arcs[2].arc.cpDyOffset).toBe(0);

    // 松葉（クレッシェンド等）はこの譜面では使っていない。
    const hairpins = data.parts.flatMap((part) =>
      (part.measures as MeasureData[]).flatMap((m) => allEvents(m).filter((ev) => ev.hairpin))
    );
    expect(hairpins).toHaveLength(0);

    const events = data.parts.flatMap((part) =>
      (part.measures as MeasureData[]).flatMap(allEvents)
    );
    expect(events).toHaveLength(140);
    expect(events.filter((ev) => ev.isRest)).toHaveLength(3);
    expect(events.filter((ev) => !ev.isRest && ev.keys.length > 1)).toHaveLength(11);
    expect(events.filter((ev) => ev.dots)).toHaveLength(3);
    expect(events.filter((ev) => ev.fingering)).toHaveLength(2);
    expect(events.filter((ev) => ev.dynamics)).toHaveLength(1);
    // テンポ表記「Adagio sostenuto」と発想標語（#237 で描画漏れが見つかった機能）が1件ずつ。
    expect(events.filter((ev) => ev.tempoMarking)).toHaveLength(1);
    expect(events.filter((ev) => ev.expressionMarking)).toHaveLength(1);
  });

  it('README 記載の「既知の入力上の傷」のうち、音高の傷2件は直されずそのまま残っている', async () => {
    const data = await loadViaImport();
    const rightHand = data.parts[0].measures as MeasureData[];

    // 傷1: 5小節目（index 4）右手声部2の最初の3連符が超低音（本来 g#/3, c#/4, e/4）。
    // #219 の誤帰属で入った実物で、#218 修正後に「救出できる」ことの検証データを兼ねる。
    const bar5Voice2 = voiceEventLists(rightHand[4])[1];
    expect(bar5Voice2.slice(0, 3).map((ev) => ev.keys)).toEqual([['b/1'], ['d#/2'], ['g#/2']]);

    // 傷2: 8小節目（index 7）右手声部2に b/3 の3重ユニゾン和音（誤クリックの実物）。
    const bar8Voice2 = voiceEventLists(rightHand[7])[1];
    expect(bar8Voice2[1].keys).toEqual(['b/3', 'b/3', 'b/3']);
  });

  // 傷3（9小節目の連符ID交錯）は Issue #282 で「読込時に直す」対象になった。
  // fixture そのものは1バイトも変えず、読み込んだあとの姿だけが変わる。
  it('傷3（9小節目の連符ID交錯）は、生データには残ったまま読込時に正規化される', async () => {
    // 生データ側: 4番目のグループの最後の1音が末尾に取り残されたまま（fixture は無改変）。
    const raw = JSON.parse(readFixtureText()) as SavedScoreData;
    const rawBar9Ids = (raw.parts[0].measures[8].voices![1].events as NoteEvent[])
      .map((ev) => ev.tuplet?.id);
    expect(new Set(rawBar9Ids).size).toBe(4);
    expect(rawBar9Ids[6]).toBe(rawBar9Ids[11]);
    expect(rawBar9Ids[8]).not.toBe(rawBar9Ids[11]);

    // 読込後: 3音ずつ4グループに区切り直され、同じ id が離れて並ぶ箇所が無くなる。
    const data = await loadViaImport();
    const rightHand = data.parts[0].measures as MeasureData[];
    const bar9 = voiceEventLists(rightHand[8])[1];
    const bar9TupletIds = bar9.map((ev) => ev.tuplet?.id);
    expect(new Set(bar9TupletIds).size).toBe(4);
    for (let group = 0; group < 4; group += 1) {
      const ids = bar9TupletIds.slice(group * 3, group * 3 + 3);
      expect(new Set(ids).size).toBe(1);
    }
    // 音の並び自体は正規化で変わらない（書き換わるのは tuplet.id だけ）。
    expect(bar9.map((ev) => ev.keys[0])).toEqual([
      'g#/3', 'b/3', 'e/4',
      'g#/3', 'b/3', 'e/4',
      'g#/3', 'b/3', 'e/4',
      'g#/3', 'b/3', 'e/4',
    ]);
  });
});
