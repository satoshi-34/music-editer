// src/utils/musicXmlImport.ts
// MusicXML ファイルを SavedScoreData 形式にパースする。
// score-partwise 形式（Finale / Sibelius / MuseScore 等が出力する標準形式）に対応。

import type { SavedScoreData, MeasureData, NoteEvent, PartData, HairpinMark, TimeSignatureStyle, AbsoluteDynamicMarking } from '../types/storage';
import { defaultRestDisplayKeyForDuration, type ClefType } from '../components/clefUtils';
import type { KeySignature } from './noteKeyUtils';
import { isValidKeySignature } from './noteKeyUtils';
import { isValidTimeSignature } from './timeSignatureUtils';
import { MAX_VOICES_PER_PART, ensureMeasuresPrimaryVoiceMaterialized, getEventDurationBeats } from './voiceMeasureUtils';
import { ensembleSecondStaffPartId } from './instrumentationPartUtils';
import { buildRestEventsForBeats } from './measureRestFillUtils';
import { readMusicXmlDefaults, type MusicXmlDefaultsLayout } from './musicXmlDefaults';
import { getTempoMarkingBpm } from './tempoMarkingPresets';

/**
 * MusicXML の <clef><sign>/<line> を ClefType に変換する。
 * C 記号は line によってアルト記号（3線目）とテナー記号（4線目）を区別する。
 */
function xmlClefToClefType(sign: string, line?: string | null): ClefType {
  if (sign === 'F') return 'bass';
  if (sign === 'C') return line === '4' ? 'tenor' : 'alto';
  return 'treble';
}

/** MusicXML の pitch 要素から VexFlow キー形式に変換する */
function pitchToKey(stepEl: Element | null, alterEl: Element | null, octaveEl: Element | null): string {
  const step = (stepEl?.textContent ?? 'C').toUpperCase();
  const alter = parseFloat(alterEl?.textContent ?? '0') || 0;
  const octave = parseInt(octaveEl?.textContent ?? '4', 10);
  const base = step.toLowerCase();
  // 微分音（alter = ±0.5）は keys 文字列には反映しない（自然音の綴りのまま）。
  // これは書出側（musicXmlExport.ts の keyToPitchXml）と同じ方針: keys は変更せず、
  // 微分音の情報は NoteEvent.microtones に独立して持たせる。
  const acc = alter === 1 ? '#' : alter === -1 ? 'b' : alter === 2 ? '##' : alter === -2 ? 'bb' : '';
  return `${base}${acc}/${octave}`;
}

/**
 * MusicXML の <note> から微分音（四分音）種別を読み取る。
 * 書出側（musicXmlExport.ts）は alter に 0.5/-0.5 と <accidental>quarter-sharp|quarter-flat</accidental>
 * の両方を出力しているため、どちらからでも判定できるようにしておく。
 */
function readMicrotoneType(noteEl: Element, alterEl: Element | null): 'quarterSharp' | 'quarterFlat' | undefined {
  const accidentalText = noteEl.querySelector('accidental')?.textContent?.trim();
  if (accidentalText === 'quarter-sharp') return 'quarterSharp';
  if (accidentalText === 'quarter-flat') return 'quarterFlat';
  const alter = parseFloat(alterEl?.textContent ?? '0') || 0;
  if (alter === 0.5) return 'quarterSharp';
  if (alter === -0.5) return 'quarterFlat';
  return undefined;
}

/** MusicXML の type 要素から当アプリの音価 DurKey に変換する */
const TYPE_TO_DUR: Record<string, string> = {
  whole: '1', half: '2', quarter: '4', eighth: '8',
  '16th': '16', '32nd': '32', '64th': '64',
};

/** MusicXML の fifths 値から当アプリの調号文字列に変換する */
const FIFTHS_TO_KEY: Record<number, KeySignature> = {
  '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F',
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
};

/** note 要素群をまとめて MeasureData.events に変換する */
let tupletGroupCounter = 0;

/**
 * 小節の子要素列から「元の連符グループ」単位で共通 id を割り当てる（クロススタッフ連符対応）。
 *
 * 連符が五線をまたぐと、同じグループの音が「自五線の実音（parseNotes 経由）」と
 * 「別五線の合成休符（syntheticTupletRest 経由）」に分かれて読まれる。id をそれぞれで
 * 採番すると描画側（createVexFlowTuplets）が「同一 id が numNotes 個連続」の条件を
 * 満たせず、連符倍率が適用されない（Codex round1 P1）。そこで**両者が読む前に**
 * 子要素の並びからグループ境界を決め、実音と合成休符へ同じ id を配る。
 *
 * 境界の規則（優先順）:
 * 1. **明示の `<notations><tuplet type="start"/"stop">`**（MusicXML の正式なグループ境界。
 *    Finale はこれを必ず書く）。start で新グループ・stop でグループを閉じる
 * 2. マーカーが無い場合のフォールバック: time-modification の無い音・<backup>・<forward>・
 *    連符比（actual/normal）の変化・**均一音価のグループが numNotes 個に達したとき**に切る。
 *    以前は「time-modification の連続」だけで判定していたため、同じ比の連符が並ぶと
 *    複数グループが1つに結合し（三連×3=9イベントの巨大グループ）、描画側の
 *    「同一 id が numNotes 個連続」条件を満たせず連符括りが消えていた（ソナチネ実測）
 * direction / attributes / 前打音 / 和音の構成音はグループを切らない。
 *
 * 既知の制約: マーカーの無い出力で**音価が混在する**連符（4分+8分の三連等）が連続する形は、
 * イベント数からは境界を判定できないため従来どおり結合したまま読む（誤って 3+1 に割るよりよい。
 * Finale / MuseScore はマーカーを書くため実害は限定的）。入れ子連符（tuplet number=2 以上）は
 * データモデルがイベントに連符を1つしか持てないため未対応（従来どおり）。
 */
function assignMeasureTupletIds(measureEl: Element): Map<Element, string> {
  const idOf = new Map<Element, string>();
  const newId = () => {
    tupletGroupCounter += 1;
    return `xml-tuplet-${tupletGroupCounter}`;
  };
  // マーカーの無い連符 run は**貯めてから**分割を決める（先読み方式）。
  // 1音ずつ切ると「8分×3のあとに4分」のような並びで、混在に気づく前に
  // 個数カットが発火して 3+1 に誤分割する（Codex round2 P1）
  let pending: Array<{ el: Element; durKey: string; actual: number }> = [];
  let pendingRatio: string | null = null;
  const flushPending = () => {
    if (pending.length) {
      const uniform = pending.every((p) => p.durKey === pending[0].durKey);
      if (uniform) {
        // 均一音価: numNotes 個ずつのグループへ分割（三連×3=9個 → 3+3+3）
        const n = pending[0].actual;
        for (let i = 0; i < pending.length; i += n) {
          const id = newId();
          for (const p of pending.slice(i, i + n)) idOf.set(p.el, id);
        }
      } else {
        // 混合音価: イベント数から境界を判定できないため1グループのまま（既知の制約）
        const id = newId();
        for (const p of pending) idOf.set(p.el, id);
      }
    }
    pending = [];
    pendingRatio = null;
  };
  let explicitId: string | null = null; // start〜stop の明示グループ（最優先・個数では切らない）
  for (const el of Array.from(measureEl.children)) {
    if (el.tagName === 'backup' || el.tagName === 'forward') { flushPending(); explicitId = null; continue; }
    if (el.tagName !== 'note') continue;
    if (el.querySelector('grace') || el.querySelector('chord')) continue;
    const timeModEl = el.querySelector('time-modification');
    if (!timeModEl) { flushPending(); explicitId = null; continue; }
    const actualNotes = parseInt(timeModEl.querySelector('actual-notes')?.textContent ?? '', 10);
    const normalNotes = parseInt(timeModEl.querySelector('normal-notes')?.textContent ?? '', 10);
    if (!Number.isInteger(actualNotes) || actualNotes <= 0 || !Number.isInteger(normalNotes) || normalNotes <= 0) {
      flushPending();
      explicitId = null;
      continue;
    }
    const marks = Array.from(el.querySelectorAll('notations tuplet')).map((t) => t.getAttribute('type'));
    if (explicitId) {
      // 明示グループの中: stop までは音価・個数に関わらず同じグループ
      idOf.set(el, explicitId);
      if (marks.includes('stop')) explicitId = null;
      continue;
    }
    if (marks.includes('start')) {
      flushPending();
      explicitId = newId();
      idOf.set(el, explicitId);
      if (marks.includes('stop')) explicitId = null; // 1音だけの明示グループ
      continue;
    }
    // マーカーの無い連符: run へ貯める（比が変われば手前で確定）
    const ratio = `${actualNotes}/${normalNotes}`;
    if (pendingRatio !== null && ratio !== pendingRatio) flushPending();
    pendingRatio = ratio;
    pending.push({
      el,
      durKey: `${el.querySelector('type')?.textContent ?? ''}:${Array.from(el.children).filter((c) => c.tagName === 'dot').length}`,
      actual: actualNotes,
    });
    // start 無しの stop（迷子マーカー）はそこまでで run を確定する
    if (marks.includes('stop')) flushPending();
  }
  flushPending();
  return idOf;
}

function parseNotes(noteEls: Element[], tupletIdByEl?: Map<Element, string>): NoteEvent[] {
  const events: NoteEvent[] = [];
  let chordBuffer: NoteEvent | null = null;
  // 連符（tuplet）の読み込み: グループ境界は assignMeasureTupletIds（<tuplet start/stop>
  // 最優先+numNotes フォールバック）が決めた id（tupletIdByEl）を使う。
  // 下の「連続性だけ」の判定は tupletIdByEl が渡されない旧経路の後方互換で、
  // 現行の読込経路では全 note が map に載るため実質使われない。
  let currentTupletId: string | null = null;
  let prevHadTimeMod = false;

  for (const noteEl of noteEls) {
    // 前打音は現状スキップ
    if (noteEl.querySelector('grace')) continue;

    const isChord = noteEl.querySelector('chord') !== null;
    const isRest = noteEl.querySelector('rest') !== null;
    const typeEl = noteEl.querySelector('type');
    const dur = TYPE_TO_DUR[typeEl?.textContent ?? ''] ?? '4';
    // <dot/> の数から付点(1個)・複付点(2個)を読み取る。3個以上は複付点として扱う（当アプリの上限が2のため）
    // :scope 疑似クラスが使えない環境もあるため、children を直接見て判定する
    const dotCount = Array.from(noteEl.children).filter((child) => child.tagName === 'dot').length;
    const dots: 1 | 2 | undefined = dotCount === 1 ? 1 : dotCount >= 2 ? 2 : undefined;

    // 連符（time-modification）の読み取り
    const timeModEl = noteEl.querySelector('time-modification');
    let tuplet: NoteEvent['tuplet'];
    if (timeModEl) {
      const actualNotes = parseInt(timeModEl.querySelector('actual-notes')?.textContent ?? '', 10);
      const normalNotes = parseInt(timeModEl.querySelector('normal-notes')?.textContent ?? '', 10);
      if (Number.isInteger(actualNotes) && actualNotes > 0 && Number.isInteger(normalNotes) && normalNotes > 0) {
        // 大譜表（クロススタッフの可能性がある経路）では、実音と合成休符が同じ id を
        // 共有できるよう、小節単位で先に決めたグループ id（assignMeasureTupletIds）を使う
        const presetId = tupletIdByEl?.get(noteEl);
        if (presetId) {
          currentTupletId = presetId;
        } else if (!prevHadTimeMod || !currentTupletId) {
          tupletGroupCounter += 1;
          currentTupletId = `xml-tuplet-${tupletGroupCounter}`;
        }
        tuplet = { id: currentTupletId, numNotes: actualNotes, notesOccupied: normalNotes };
      }
      prevHadTimeMod = true;
    } else {
      prevHadTimeMod = false;
      currentTupletId = null;
    }

    if (isRest) {
      if (chordBuffer) { events.push(chordBuffer); chordBuffer = null; }
      events.push({ dur: dur as any, isRest: true, keys: [], dots, tuplet });
      continue;
    }

    const step = noteEl.querySelector('step');
    const alter = noteEl.querySelector('alter');
    const octave = noteEl.querySelector('octave');
    const key = pitchToKey(step, alter, octave);
    const microtoneType = readMicrotoneType(noteEl, alter);

    if (isChord && chordBuffer) {
      // 和音: 前の音符に音高を追加する
      const keyIndex = chordBuffer.keys.length;
      chordBuffer.keys.push(key);
      if (microtoneType) {
        chordBuffer.microtones = [...(chordBuffer.microtones ?? []), { keyIndex, type: microtoneType }];
      }
      // この音にも運指番号があれば、既存の運指リストにカンマ区切りで追加する
      // （和音の音の順番と運指番号の順番を対応させるため）
      const chordFingerEl = noteEl.querySelector('technical fingering');
      if (chordFingerEl?.textContent) {
        chordBuffer.fingering = chordBuffer.fingering
          ? `${chordBuffer.fingering},${chordFingerEl.textContent.trim()}`
          : chordFingerEl.textContent.trim();
      }
    } else {
      if (chordBuffer) events.push(chordBuffer);
      chordBuffer = { dur: dur as any, isRest: false, keys: [key], dots, tuplet };
      if (microtoneType) {
        chordBuffer.microtones = [{ keyIndex: 0, type: microtoneType }];
      }

      // アーティキュレーションを読み込む
      const articulations: string[] = [];
      if (noteEl.querySelector('staccato')) articulations.push('staccato');
      if (noteEl.querySelector('accent')) articulations.push('accent');
      if (noteEl.querySelector('tenuto')) articulations.push('tenuto');
      if (noteEl.querySelector('strong-accent')) articulations.push('marcato');
      if (noteEl.querySelector('fermata')) articulations.push('fermata');
      if (articulations.length) chordBuffer.articulations = articulations as any;

      // 装飾記号（1音符につき1種類。複数該当する場合は最初に見つかったものを優先）
      if (noteEl.querySelector('trill-mark')) chordBuffer.ornament = 'trill';
      else if (noteEl.querySelector('mordent')) chordBuffer.ornament = 'mordent';
      else if (noteEl.querySelector('inverted-mordent')) chordBuffer.ornament = 'mordentInverted';
      else if (noteEl.querySelector('turn')) chordBuffer.ornament = 'turn';

      // 歌詞
      const lyricEl = noteEl.querySelector('lyric text');
      if (lyricEl?.textContent) chordBuffer.lyrics = lyricEl.textContent;

      // 運指番号（この音符の1音目ぶん。和音の2音目以降は isChord 分岐側で追加する）
      const fingerEl = noteEl.querySelector('technical fingering');
      if (fingerEl?.textContent) chordBuffer.fingering = fingerEl.textContent.trim();
    }
  }
  if (chordBuffer) events.push(chordBuffer);
  return events;
}

/** 取り込める文字の強弱記号（書き出し側 dynamicsDirectionXml と同じ範囲。#552） */
const IMPORTABLE_ABSOLUTE_DYNAMICS: readonly AbsoluteDynamicMarking[] = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];

/**
 * <direction> の中の <dynamics> から、取り込める文字の強弱記号だけを取り出す（#552）。
 * <dynamics> の中身は <p/> <ff/> のように「記号名そのものがタグ名」になっている。
 * 対応表に無いもの（sfz・fp・ppp など）は取り込まない——近い値へ勝手に寄せると
 * 譜面が黙って書き換わるため。捨てた件数は読み込み後にまとめて通知する
 * （countUnsupportedDynamics）。
 */
function readImportableDynamics(directionEl: Element): AbsoluteDynamicMarking[] {
  const dynamicsEls = Array.from(directionEl.querySelectorAll('direction-type > dynamics'));
  const values: AbsoluteDynamicMarking[] = [];
  for (const dynamicsEl of dynamicsEls) {
    for (const child of Array.from(dynamicsEl.children)) {
      const value = child.tagName as AbsoluteDynamicMarking;
      if (IMPORTABLE_ABSOLUTE_DYNAMICS.includes(value)) values.push(value);
    }
  }
  return values;
}

/**
 * 松葉（ヘアピン）・文字の強弱記号（pp〜ff）・ペダル記号を1つの声部の NoteEvent へ復元する。
 * 書出側（musicXmlExport.ts）は
 * 「開始音符の直前に <direction><wedge type="crescendo|diminuendo"/></direction>」
 * 「終了音符の直後に <direction><wedge type="stop"/></direction>」
 * 「音符の直前に <direction><dynamics><p/></dynamics></direction>」
 * 「音符の直前に <direction><pedal type="start|stop"/></direction>」（#568）
 * という並びで出力しているため、<measure> の直下の子要素（note と direction）を
 * 出現順に読み、直前/直後の note との対応を追いながら組み立てる。
 * 松葉・文字強弱・ペダルは「直前の direction を次の音符へ付ける」という同じ規則なので、
 * 走査を増やさず1本ですべてを組み立てる（同じ歩き方の2枚目を作らない。#552 / #568）。
 *
 * 声部1（<backup> より前）と声部2（<backup> より後）で同じ処理が使えるので、
 * 呼び出し側が「その声部ぶんの子要素・イベント配列・待ち行列」を渡す形にしてある。
 *
 * @param children その声部に属する <measure> 直下の子要素（声部1なら <backup> より前、声部2なら後）
 * @param events parseNotes(その声部のnoteEls) の結果。ここへ hairpins を直接書き込む
 * @param measureIndex この小節の絶対インデックス（HairpinMark.endMeasure に使う）
 * @param openRefs まだ <wedge type="stop"/> に出会っていない HairpinMark の待ち行列。
 *   パート全体で1つを使い回すことで、小節をまたぐ松葉にも対応する（FIFO想定）。
 *   声部をまたぐ松葉は作らない設計なので、待ち行列も声部ごとに分ける
 *   （混ぜると声部1の stop が声部2の松葉を閉じてしまう）。
 */
/** 小節をまたぐペダル記号の持ち越し（#568 round1 P1）。声部ごとに1つ持つ */
type PedalCarry = { pending: 'down' | 'up' | null };

function attachDirectionMarksToVoiceEvents(
  children: Element[],
  events: NoteEvent[],
  measureIndex: number,
  openRefs: HairpinMark[],
  pedalCarry: PedalCarry,
  syntheticRestCount?: (el: Element) => number,
  options?: {
    /**
     * 松葉（ヘアピン）を復元しない（round2 P2）。声部3以降は現行 UI が松葉2声まで
     * のため文字強弱だけを復元する。openRefs に空配列を渡すだけでは無効化にならず、
     * 同一小節内の松葉が復元され、小節またぎでは開始位置で終わる壊れた松葉が残る
     */
    skipHairpins?: boolean;
  },
): void {
  let eventIndex = -1;
  let pendingTypes: Array<'cresc' | 'dim'> = [];
  // 次の音符へ付ける文字の強弱記号（#552）。松葉の pendingTypes と同じ「待ち」の仕組み
  let pendingDynamics: AbsoluteDynamicMarking[] = [];
  // 次の音符へ付けるペダル記号（#568）。強弱と同じ「待ち」の仕組みに乗せるが、
  // 小節末の direction を次小節の先頭音符へ持ち越すため、状態は呼び出し側の
  // pedalCarry（小節ループの外）に置く（round1 P1）。
  // 1つの音符が持てるペダル記号は1つ（down か up）なので、配列ではなく最後の1つを覚える

  for (const child of children) {
    if (child.tagName === 'direction') {
      pendingDynamics.push(...readImportableDynamics(child));
      const pedalType = child.querySelector('direction-type > pedal')?.getAttribute('type');
      // type="change"（踏み替え）は、このアプリのデータモデルでは
      // 「離してすぐ踏む」を1つで表せないため、v1 では「踏む」として取り込む（#568 仕様2）
      if (pedalType === 'start' || pedalType === 'change') pedalCarry.pending = 'down';
      else if (pedalType === 'stop') pedalCarry.pending = 'up';
      const wedgeType = options?.skipHairpins
        ? null
        : child.querySelector('wedge')?.getAttribute('type');
      if (wedgeType === 'crescendo') pendingTypes.push('cresc');
      else if (wedgeType === 'diminuendo') pendingTypes.push('dim');
      else if (wedgeType === 'stop') {
        const ref = openRefs.shift();
        if (ref && eventIndex >= 0) {
          ref.endMeasure = measureIndex;
          ref.endEvent = eventIndex;
        }
      }
      continue;
    }
    {
      // <forward> や別五線の音符（クロススタッフ）から合成した休符イベントのぶん
      // 対応位置を進める（進めないと以降の松葉の付き先が前へずれる）
      const synthetic = syntheticRestCount?.(child) ?? 0;
      if (synthetic > 0) { eventIndex += synthetic; continue; }
    }
    if (child.tagName !== 'note') continue;
    // parseNotes と同じ判定（前打音はスキップ、和音の2音目以降は新しい event を作らない）
    if (child.querySelector('grace')) continue;
    const isChordNote = child.querySelector('chord') !== null;
    if (isChordNote) continue;
    eventIndex += 1;
    if (pendingTypes.length === 0 && pendingDynamics.length === 0 && pedalCarry.pending === null) continue;
    const ev = events[eventIndex];
    if (!ev) continue;
    if (pedalCarry.pending !== null) {
      ev.pedalMark = pedalCarry.pending;
      pedalCarry.pending = null;
    }
    for (const type of pendingTypes) {
      const mark: HairpinMark = { type, endMeasure: measureIndex, endEvent: eventIndex };
      ev.hairpins = [...(ev.hairpins ?? []), mark];
      openRefs.push(mark);
    }
    pendingTypes = [];
    if (pendingDynamics.length > 0) {
      // 同じ音符に同じ記号が二重に付かないようにする（<dynamics> が重複して
      // 書かれたファイル・往復で二重に付いたデータのどちらでも1つに畳む）
      const existing = new Set((ev.dynamics ?? []).map((d) => d.value));
      const added: typeof pendingDynamics = [];
      for (const value of pendingDynamics) {
        // 追加中にも Set を更新する（round1 P3: pendingDynamics 自体が ['p','p'] と
        // 重複しているファイルで、同じ記号を2件追加してしまう）
        if (existing.has(value)) continue;
        existing.add(value);
        added.push(value);
      }
      if (added.length > 0) {
        ev.dynamics = [...(ev.dynamics ?? []), ...added.map((value) => ({ value }))];
      }
      pendingDynamics = [];
    }
  }
}

/**
 * ファイル全体で「取り込めなかった文字の強弱記号」の数を数える（#552）。
 *
 * 声部・五線ごとの走査で数えると、五線で分けて2回読むパート（大譜表）で
 * 二重に数えてしまうため、ここで文書全体を1回だけ見る。
 */
function countUnsupportedDynamics(root: Element): number {
  let count = 0;
  for (const dynamicsEl of Array.from(root.querySelectorAll('direction-type > dynamics'))) {
    for (const child of Array.from(dynamicsEl.children)) {
      // <other-dynamics> も「対応表に無い記号」として数える（中身は自由文字列）
      if (!IMPORTABLE_ABSOLUTE_DYNAMICS.includes(child.tagName as AbsoluteDynamicMarking)) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * 上限（4声/段）を超える声部を持つ <measure> の数を数える（#417 Codex round1 P1-4）。
 * 取り込みでは5声目以降を捨てるので、捨てた事実を画面へ返して通知させる（#318）。
 * countUnsupportedDynamics と同じく、取り込み本体とは独立に XML から数える。
 */
function countVoicesOverLimit(root: Element): number {
  let count = 0;
  for (const measureEl of Array.from(root.querySelectorAll('measure'))) {
    let maxVoice = 1;
    for (const voiceEl of Array.from(measureEl.querySelectorAll('note > voice'))) {
      const n = Number(voiceEl.textContent ?? '1');
      if (Number.isFinite(n) && n > maxVoice) maxVoice = n;
    }
    if (maxVoice > MAX_VOICES_PER_PART) count += 1;
  }
  return count;
}

/** 1つの <part> が持てる五線の数の上限（大譜表=2、オルガン譜=3 を想定した安全弁） */
const MAX_STAVES_PER_PART = 4;

/**
 * <note> / <direction> が属する五線の番号を返す。
 * MusicXML では 1つの <part> に複数の五線がある譜（ピアノ大譜表など）で、
 * 各要素が <staff>1</staff> のように自分の五線を名乗る。<staff> が無い場合は
 * 1番目の五線に属する。
 */
function staffNumberOf(el: Element): number {
  const n = parseInt(el.querySelector('staff')?.textContent ?? '', 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** <part> が宣言している五線の数（<attributes><staves>）。宣言が無ければ 1 */
function readStaffCount(partEl: Element): number {
  const n = parseInt(partEl.querySelector('attributes staves')?.textContent ?? '', 10);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, MAX_STAVES_PER_PART);
}

/**
 * <attributes> の中から、その五線に対応する <clef> を選んで ClefType に変換する。
 * 複数五線の譜では <clef number="1">ト音</clef><clef number="2">ヘ音</clef> のように
 * number 属性で五線を指す。該当が無ければ最初の <clef> を使う。
 */
function clefForStaff(attrsEl: Element | null, staffNumber: number | null): ClefType | null {
  if (!attrsEl) return null;
  const clefEls = Array.from(attrsEl.querySelectorAll('clef'));
  if (clefEls.length === 0) return null;
  const matched = staffNumber !== null
    ? clefEls.find((el) => (parseInt(el.getAttribute('number') ?? '1', 10) || 1) === staffNumber)
    : undefined;
  const target = matched ?? clefEls[0];
  const sign = target.querySelector('sign')?.textContent ?? 'G';
  const line = target.querySelector('line')?.textContent;
  return xmlClefToClefType(sign, line);
}

/**
 * <attributes> の中から「その五線を明示的に指している <clef>」だけを取り出す（#453）。
 *
 * clefForStaff との違いは、該当が無いときに先頭の <clef> へフォールバックしないこと。
 * 小節の途中に置かれた <clef number="1"> は上段だけのクレフ変更なので、下段を読んでいる
 * ときにフォールバックで拾うと、指示されていない段のクレフまで変わってしまう。
 * MusicXML の number 属性の既定値は 1 なので、番号なしの <clef> は第1五線を指す扱いにする。
 */
function clefForStaffExact(attrsEl: Element, staffNumber: number | null): ClefType | null {
  const clefEls = Array.from(attrsEl.querySelectorAll('clef'));
  if (clefEls.length === 0) return null;
  const target = staffNumber === null
    ? clefEls[0]
    : clefEls.find((el) => (parseInt(el.getAttribute('number') ?? '1', 10) || 1) === staffNumber);
  if (!target) return null;
  const sign = target.querySelector('sign')?.textContent ?? 'G';
  const line = target.querySelector('line')?.textContent;
  return xmlClefToClefType(sign, line);
}

/** 拍位置の突き合わせに使う許容誤差（divisions 割り算の丸め対策。1e-6 拍＝実質ゼロ） */
const BEAT_EPSILON = 1e-6;

/**
 * 1小節の中に現れる <attributes><clef> を「小節の頭のもの」と「小節途中のもの」に分けて拾う（#453）。
 *
 * MusicXML では小節の途中にも <attributes> を置ける（月光ソナタ37小節のように、
 * 小節の途中でト音→ヘ音記号へ変わる書き方）。どこで変わったかは要素の並び順ではなく
 * **小節先頭からの時間**で決まるので、MusicXML の時間カーソル（音符と <forward> で進み、
 * <backup> で戻る）をたどりながら位置を測る。こうしておけば、<backup> で区切られた
 * 下声の側に書かれたクレフ変更でも、同じ時刻の主声部の音へ正しく結び付けられる。
 *
 * @param divisions この小節で有効な <divisions>（4分音符1つぶんの単位数）
 * @returns headClef = 小節の頭（時刻0）のクレフ / midClefs = 小節途中のクレフ（拍位置つき）
 */
function collectMeasureClefs(
  measureEl: Element,
  staffNumber: number | null,
  divisions: number
): { headClef: ClefType | null; midClefs: { beat: number; clef: ClefType }[] } {
  const durationOf = (el: Element): number => {
    const d = parseInt(el.querySelector('duration')?.textContent ?? '', 10);
    return Number.isInteger(d) && d > 0 ? d : 0;
  };
  let cursor = 0;
  let headClef: ClefType | null = null;
  const midClefs: { beat: number; clef: ClefType }[] = [];
  for (const el of Array.from(measureEl.children)) {
    if (el.tagName === 'attributes') {
      const clef = clefForStaffExact(el, staffNumber);
      if (clef) {
        if (cursor <= 0) headClef = clef;
        else midClefs.push({ beat: cursor / divisions, clef });
      }
      continue;
    }
    if (el.tagName === 'backup') { cursor = Math.max(0, cursor - durationOf(el)); continue; }
    if (el.tagName === 'forward') { cursor += durationOf(el); continue; }
    if (el.tagName === 'note') {
      // 和音の構成音（<chord/>）は親音と同時刻、前打音（<grace/>）は時間を持たないので進めない
      if (el.querySelector('chord') || el.querySelector('grace')) continue;
      cursor += durationOf(el);
    }
  }
  return { headClef, midClefs };
}

/**
 * <part-name> の表示名を、アプリ内の安定 partId へ正規化する（#443）。
 *
 * 書き出し側（#443）は <part-name> に表示名（Violin I / Violoncello 等）を出すため、
 * partId 照合（ScorePage の四重奏読込は 'violin-1' 等の一致で器へ載せる）が
 * 表示名のままだと空振りする。既知の表示名は安定IDへ戻し、それ以外（一般の外部
 * ファイルの名前・旧形式で partId がそのまま入っている場合）は素通しする。
 * Finale 等の実ファイルでも Violin I / Violoncello は慣用名なので、外部持ち込みの
 * 命中率も上がる。大文字小文字は無視して照合する。
 */
const DISPLAY_NAME_TO_PART_ID: Record<string, string> = {
  'violin i': 'violin-1',
  'violin ii': 'violin-2',
  'viola': 'viola',
  'violoncello': 'cello',
  'cello': 'cello',
  'piano (right hand)': 'right-hand',
  'piano (left hand)': 'left-hand',
  'melody': 'melody',
};
function normalizeImportedPartName(partName: string): string {
  return DISPLAY_NAME_TO_PART_ID[partName.trim().toLowerCase()] ?? partName;
}

/**
 * 五線ごとに分けた PartData の partId を決める。
 * 単独パートの大譜表（＝ピアノ譜）は、アプリ側の右手／左手の器へそのまま載せられるよう
 * 'right-hand' / 'left-hand' にそろえる（読込側は clef でも右手/左手を判定するが、
 * partId も保存データの慣習に合わせておく）。
 */
function staffPartId(
  partName: string,
  staffNumber: number | null,
  staffCount: number,
  totalPartCount: number,
): string {
  if (staffNumber === null) return normalizeImportedPartName(partName);
  if (totalPartCount === 1 && staffCount === 2) return staffNumber === 1 ? 'right-hand' : 'left-hand';
  if (staffNumber === 1) return normalizeImportedPartName(partName);
  // 編成譜の「パート内2段目」は保存データと同じ `${partId}::2` 形式にそろえる
  if (staffNumber === 2) return ensembleSecondStaffPartId(normalizeImportedPartName(partName));
  return `${normalizeImportedPartName(partName)}::${staffNumber}`;
}

/**
 * 1つの五線ぶんの小節データを組み立てる。
 *
 * @param measureEls その <part> の <measure> 要素すべて
 * @param staffNumber 取り出す五線の番号。null は「五線で分けない」（<staves> が無い従来の譜）
 */
function buildStaffMeasures(
  measureEls: Element[],
  staffNumber: number | null,
  staffClef: ClefType,
  // 楽譜全体の調号（fifths）と拍子。先頭の <attributes> から読んだ「この曲の既定値」で、
  // 各小節の <attributes> が「本当に変更なのか、同じ内容の書き直しなのか」を判断する
  // 比較相手になる（Issue #526）。
  scoreKeyFifths: number = 0,
  scoreTimeSignature: [number, number] = [4, 4],
): MeasureData[] {
  // 松葉（ヘアピン）は小節をまたぐ場合があるため、パート全体で1つの待ち行列を使い回す。
  // 声部1と声部2で別々に持つのは、<backup> を挟んで別々の松葉が同時に開くことがあるため。
  const openHairpinRefs: HairpinMark[] = [];
  const openHairpinRefsVoice2: HairpinMark[] = [];
  // 声部3以降ぶんの待ち行列（#417 Codex round1 P1-5）。編集 UI が N 声になり
  // 声部3・4にも松葉を置けるようになったので、取り込みでも声部ごとに待ち行列を持つ。
  // 1本を共用すると、別々の声部で同時に開いた松葉の stop が取り違えられる
  // （声部1・2を別々に持っているのと同じ理由）
  const openHairpinRefsByVoice = new Map<number, HairpinMark[]>();
  // 小節をまたいで持ち越すペダル記号（#568 round1 P1）。MusicXML の direction は
  // 「同じ声部で後続する最初の音符」に付くため、小節最後の音符の**後**に置かれた
  // <pedal type="stop"/> は次小節の先頭イベントへ付け直す必要がある。
  // 松葉の openHairpinRefs と同じく、声部ごとに小節ループの外で状態を持つ
  const pedalCarryVoice1: PedalCarry = { pending: null };
  const pedalCarryVoice2: PedalCarry = { pending: null };
  const pedalCarryByVoice = new Map<number, PedalCarry>();
  // <voice> 番号 → アプリの声部番号（1始まり）の対応表は**パート全体から一度だけ**作る。
  // 小節ごとに作ると「voice 6 だけの小節では voice-1、voice 5・6 が揃う小節では voice-2」と
  // 同じ声部が小節境界で入れ替わり、編集レイヤー・再生・松葉の継続が壊れる（Codex round1 P1）
  const globalVoiceNumbers = staffNumber === null ? null : Array.from(new Set(
    measureEls.flatMap((m) => Array.from(m.children)
      // 和音の構成音は親音と同じ voice を持つ（別五線を名乗るクロススタッフ和音も
      // 時間・声部は親音側）ので、対応表は親音（chordなし）だけから作る
      .filter((el) => el.tagName === 'note' && !el.querySelector('chord') && staffNumberOf(el) === staffNumber)
      .map((el) => parseInt(el.querySelector('voice')?.textContent ?? '', 10))
      .filter((v) => Number.isInteger(v) && v >= 1)),
  )).sort((a, b) => a - b);
  // <forward>（時間送り）の長さは <duration>（divisions 単位）でしか書かれないため、
  // <attributes><divisions> をパート先頭から追跡する（MusicXML の既定値は 1 = 4分音符）
  let divisions = 1;
  // 途中クレフ変更（#453）の取り込み用。runningClef は「前の小節の末尾時点で有効なクレフ」で、
  // 同じクレフを念押しで書いた <clef> を「変更」と誤読しないための比較相手になる。
  // carriedClef は小節の末尾（最後の音符より後ろ）に置かれた予告クレフで、実譜と同じく
  // 次の小節の頭から有効として扱う
  let runningClef: ClefType = staffClef;
  let carriedClef: ClefType | null = null;
  // 調号・拍子も「前の小節の時点で有効な値」を持ち回り、**変わったときだけ**小節へ記録する
  // （クレフの runningClef と同じ考え方）。Finale などの書き出しは、変更が無くても
  // 毎小節 <attributes> に <key>・<time> を書き直すことがある。これをそのまま
  // 「この小節で調号・拍子が変わる」として取り込むと、段割りの計画（planEffectiveMeasuresPerSystem）
  // が「この小節には調号と拍子が描かれる」と見なして小節幅を過大に見積もり、
  // 1段に入る小節数が不当に減る（Issue #526: 読み込むと全段が1小節/段になる）。
  // 描画側（PianoSystemCanvas）は前の小節と比べて変化したときだけ記号を出すので、
  // 記録しないことで見た目は変わらない。
  let runningKeyFifths = scoreKeyFifths;
  let runningTimeSig: [number, number] = scoreTimeSignature;
  return measureEls.map((measureEl, mi) => {
    const divEl = measureEl.querySelector('attributes divisions');
    const divVal = parseInt(divEl?.textContent ?? '', 10);
    if (Number.isInteger(divVal) && divVal > 0) divisions = divVal;
    // <forward> を「その長さぶんの休符」へ合成する。無視すると後続の音が小節先頭へ詰まり、
    // 「backup → forward 半小節 → 後半だけの声部」のような外部ソフト定番の書き方で
    // リズムが黙って壊れる（Codex round1 P1）
    const durationRests = (el: Element): NoteEvent[] => {
      // 連符の音が五線をまたぐ形は、合成休符が二進音価しか表せず 1/3 拍などの端数を
      // 落として両段の時間がずれる（round3 P1）。以前は理由付きで読込を中止していたが、
      // Finale 実ファイル（ピアノ曲の右手↔左手またぎ・2026-08-29 ラヴェル ソナチネで実測）が
      // 普通に該当するため、「同じ音価+同じ連符比を持つ休符」への1:1置換で時間を厳密に
      // 保存して読み込む（下の syntheticTupletRest を参照）
      if (el.tagName === 'note' && el.querySelector('time-modification')) {
        const rest = syntheticTupletRest.get(el);
        if (rest) {
          // 同じ el を「イベント生成」と「位置数え（syntheticRestCount）」の2回参照するため、
          // 使い回しで hairpins 等が二重に付かないよう毎回複製する
          return [{ ...rest, tuplet: rest.tuplet ? { ...rest.tuplet } : undefined }];
        }
        // actual/normal が壊れていて比を復元できない場合だけ、従来どおり黙って壊さず中止する
        throw new Error(
          '連符が五線をまたぐクロススタッフ記譜を含むため、この MusicXML は読み込めません。書き出し元で段またぎ（クロススタッフ）を外してから書き出してください（読み込み後に ⇵ で見た目を付け直せます）',
        );
      }
      const d = parseInt(el.querySelector('duration')?.textContent ?? '', 10);
      if (!Number.isInteger(d) || d <= 0) return [];
      return buildRestEventsForBeats(d / divisions, staffClef);
    };
    // この要素が「音符としては読まず、休符として合成する」対象か。
    // <forward>（時間送り）と、別五線へ移った音符（クロススタッフ）の2種。
    // 和音の2音目以降（<chord/>）と前打音（<grace/>）は時間を持たないので対象外
    const isSyntheticRestEl = (el: Element): boolean => {
      if (el.tagName === 'forward') return true;
      if (el.tagName !== 'note' || staffNumber === null) return false;
      if (noteUnitStaff(el) === staffNumber) return false;
      return !el.querySelector('chord') && !el.querySelector('grace');
    };
    const parseVoiceChildren = (children: Element[]): NoteEvent[] => {
      const evs: NoteEvent[] = [];
      let noteRun: Element[] = [];
      const flush = () => { if (noteRun.length) { evs.push(...parseNotes(noteRun, measureTupletIdOf)); noteRun = []; } };
      for (const el of children) {
        if (isSyntheticRestEl(el)) { flush(); evs.push(...durationRests(el)); continue; }
        if (el.tagName === 'note') {
          // ユニット五線（和音は親音の五線）が別ならここへは来ない（synthetic 側で処理済み）。
          // 前打音だけは時間を持たないので、別五線でも黙って飛ばす
          if (staffNumber !== null && noteUnitStaff(el) !== staffNumber) continue;
          noteRun.push(el);
        }
      }
      flush();
      return evs;
    };
    const syntheticRestCount = (el: Element): number => (isSyntheticRestEl(el) ? durationRests(el).length : 0);
    // 追加声部（下声など）は書出側が <backup> で区切って出力している。
    // #244 段5-5: 旧実装は最初の <backup> だけで2分割しており、3声以上の自己往復で
    // 声部3以降が声部2へ連結される（4声→2声へ潰れる）データ破壊があった。
    // さらに区間の順番だけで声部を決めると、空声部をスキップして書き出された疎なデータ
    // （声部2なし・声部3あり）や外部ソフト由来の XML で番号がずれる（Codex 2巡目 P1）。
    // <backup> は「時間の巻き戻し」であって声部番号ではないため、区間ごとの声部番号は
    // 各 note の <voice> タグから決める（タグの無い XML は従来どおり区間順で数える）。
    // 五線ごとに分けるときは、その五線に属さない note / direction を先に除く。
    // <backup>（時間の巻き戻し）や <attributes> は五線に属さないので残す。
    // 和音は**親音（<chord/> の無い最初の音）の五線**をユニットの五線とする（round3 P1）。
    // MusicXML では和音の構成音が別五線を名乗れる（クロススタッフ和音）が、時間は親音が
    // 持つため、構成音を独立に扱うと同時発音が「休符＋遅れた音」に分裂する。
    // ここで note ごとのユニット五線を先に求め、以降の判定はすべてこれを使う
    const unitStaffOf = new Map<Element, number>();
    {
      let lastParentStaff = 1;
      for (const el of Array.from(measureEl.children)) {
        if (el.tagName !== 'note') continue;
        if (el.querySelector('chord')) {
          unitStaffOf.set(el, lastParentStaff);
        } else {
          lastParentStaff = staffNumberOf(el);
          unitStaffOf.set(el, lastParentStaff);
        }
      }
    }
    const noteUnitStaff = (el: Element): number => unitStaffOf.get(el) ?? staffNumberOf(el);
    // クロススタッフ連符の合成休符（round3 P1 の読込拒否の解除）:
    // 別五線へ移った連符の音を「同じ音価・付点・連符比を持つ休符」へ1:1で置き換える。
    // duration/divisions からの二進分割（buildRestEventsForBeats）では 1/3 拍などを
    // 表せないが、音価+連符比をそのまま写せば時間は厳密に保存される。
    // グループ id は assignMeasureTupletIds が「元の連符グループ」単位で決めたものを、
    // 実音（parseNotes）と合成休符の**両方**が共有する。id を別々に採番すると描画側の
    // 「同一 id が numNotes 個連続」条件が満たせず連符倍率が適用されない（Codex round1 P1）。
    // 時間は正しく保存され、またぎの見た目は読込後に ⇵ で付け直せる
    const measureTupletIdOf = assignMeasureTupletIds(measureEl);
    const syntheticTupletRest = new Map<Element, NoteEvent>();
    for (const el of Array.from(measureEl.children)) {
      const timeModEl = el.tagName === 'note' ? el.querySelector('time-modification') : null;
      const isTarget = timeModEl !== null && staffNumber !== null
        && noteUnitStaff(el) !== staffNumber
        && !el.querySelector('chord') && !el.querySelector('grace');
      if (!isTarget) continue;
      const groupId = measureTupletIdOf.get(el);
      if (!groupId) continue; // 連符比が壊れている場合は id が無い → durationRests 側で中止
      const actualNotes = parseInt(timeModEl.querySelector('actual-notes')?.textContent ?? '', 10);
      const normalNotes = parseInt(timeModEl.querySelector('normal-notes')?.textContent ?? '', 10);
      const dur = (TYPE_TO_DUR[el.querySelector('type')?.textContent ?? ''] ?? '4') as NoteEvent['dur'];
      const dotCount = Array.from(el.children).filter((c) => c.tagName === 'dot').length;
      const dots: 1 | 2 | undefined = dotCount === 1 ? 1 : dotCount >= 2 ? 2 : undefined;
      syntheticTupletRest.set(el, {
        dur,
        isRest: true,
        keys: [defaultRestDisplayKeyForDuration(staffClef, dur)],
        dots,
        tuplet: { id: groupId, numNotes: actualNotes, notesOccupied: normalNotes },
      });
    }
    // 別五線の <note> は**捨てずに残す**: 同じ voice が小節内で五線を移るクロススタッフ記譜では、
    // 捨てると先行音の時間が消えて後続が小節先頭へ詰まる（Codex round2 P1）。
    // 残した別五線の音は parseVoiceChildren で「同じ長さの休符」に合成する（時間を保存し、
    // 見た目のまたぎは読み込み後に ⇵ で付け直せる）。direction だけは自五線ぶんに絞る
    const allChildren = Array.from(measureEl.children).filter((el) => {
      if (staffNumber === null) return true;
      if (el.tagName !== 'direction') return true;
      return staffNumberOf(el) === staffNumber;
    });
    const rawSections: Element[][] = [[]];
    for (const el of allChildren) {
      if (el.tagName === 'backup') {
        rawSections.push([]);
      } else {
        rawSections[rawSections.length - 1].push(el);
      }
    }
    const explicitSectionVoice = (children: Element[]): number | null => {
      const firstNote = children.find((el) => el.tagName === 'note'
        && (staffNumber === null || noteUnitStaff(el) === staffNumber));
      const v = parseInt(firstNote?.querySelector('voice')?.textContent ?? '', 10);
      return !isNaN(v) && v >= 1 ? v : null;
    };
    // 五線で分けたときは、その五線の音符が1つも残らなかった区間（＝別の五線ぶんの区間）を
    // 捨ててから声部を数える。残すと空の声部が増えてしまう。
    const sections = staffNumber === null
      ? rawSections
      : rawSections.filter((children) =>
          children.some((el) => el.tagName === 'note' && noteUnitStaff(el) === staffNumber));
    // MusicXML の <voice> 番号は五線をまたいだ通し番号になる慣習がある
    // （例: 右手が 1・2、左手が 5・6）。パート全体の対応表（globalVoiceNumbers）で
    // 1 から振り直して、アプリの「声部1・声部2…」と対応させる。
    // <voice> タグの無い区間は従来どおり区間順（si+1）で数える
    const sectionsWithVoice = sections.map((children, si) => {
      const explicit = explicitSectionVoice(children);
      const voiceNumber = staffNumber !== null && explicit !== null && globalVoiceNumbers
        ? globalVoiceNumbers.indexOf(explicit) + 1
        : (explicit ?? si + 1);
      return { children, voiceNumber };
    });
    const childrenForVoice = (n: number): Element[] =>
      sectionsWithVoice.filter((s) => s.voiceNumber === n).flatMap((s) => s.children);
    const voice1Children = childrenForVoice(1);
    const voice2Children = childrenForVoice(2);

    const events = parseVoiceChildren(voice1Children);
    attachDirectionMarksToVoiceEvents(voice1Children, events, mi, openHairpinRefs, pedalCarryVoice1, syntheticRestCount);

    const voice2Events = parseVoiceChildren(voice2Children);
    // 声部2の松葉も同じ方式で復元する（voice2Events の要素を直接書き換える）
    attachDirectionMarksToVoiceEvents(voice2Children, voice2Events, mi, openHairpinRefsVoice2, pedalCarryVoice2, syntheticRestCount);

    // 声部3以降（松葉の復元は現行 UI が2声までなので行わない。「壊れず全声部が戻る」水準）。
    // 疎な番号（間の声部が空）は空の器で埋め、声部番号を保存データ上の位置と一致させる
    const noteBearingVoiceNumbers = sectionsWithVoice
      .filter((s) => s.children.some((el) => el.tagName === 'note'
        && (staffNumber === null || noteUnitStaff(el) === staffNumber)))
      .map((s) => s.voiceNumber);
    const maxVoiceNumber = noteBearingVoiceNumbers.length > 0 ? Math.max(...noteBearingVoiceNumbers) : 1;
    const extraVoiceEvents: NoteEvent[][] = [];
    // 上限（4声/段）で打ち切る（#417 Codex round1 P1-4）。5声目以降を読むと、
    // 編集 UI からは触れないのに再生・再保存にだけ現れる「見えない声部」になる。
    // 打ち切ったことは parseMusicXmlWithDefaults が件数で返し、画面が通知する
    for (let n = 3; n <= Math.min(maxVoiceNumber, MAX_VOICES_PER_PART); n++) {
      const childrenN = childrenForVoice(n);
      const eventsN = parseVoiceChildren(childrenN);
      // 強弱は全声部で復元する（round1 P2: 書き出しは全声部へ <dynamics> を出すため、
      // 復元しないと声部3以降の f 等が**無通知のまま**往復で消える）。
      // 松葉も声部3・4で復元する（#417 Codex round1 P1-5: 編集 UI が N 声になり
      // 声部3・4へ松葉を置けるようになった以上、往復で消えるのは無通知の欠損になる）
      const carryN = pedalCarryByVoice.get(n) ?? { pending: null };
      pedalCarryByVoice.set(n, carryN);
      const hairpinRefsN = openHairpinRefsByVoice.get(n) ?? [];
      openHairpinRefsByVoice.set(n, hairpinRefsN);
      attachDirectionMarksToVoiceEvents(childrenN, eventsN, mi, hairpinRefsN, carryN, syntheticRestCount);
      extraVoiceEvents.push(eventsN);
    }

    // リピート
    const leftBarline = measureEl.querySelector('barline[location="left"] repeat');
    const rightBarline = measureEl.querySelector('barline[location="right"] repeat');

    // 小節単位テンポ（sound/@tempo があれば取得）。
    // ただし速度標語の direction に併記された <sound>（<words> と同じ <direction> 内）は
    // 「標語の目安BPM」であって数値テンポ変更ではないので除外する。除外しないと、
    // 標語だけの小節が往復で「標語+数値テンポ」に化け、数値が標語より優先される
    // 規則（#516）により、標語を書き替えても再生が変わらなくなる（Codex round1 P1）
    const soundEl = Array.from(measureEl.querySelectorAll('sound[tempo]')).find(
      (el) => !el.closest('direction')?.querySelector('direction-type words'),
    );
    const bpm = soundEl ? parseInt(soundEl.getAttribute('tempo') ?? '', 10) : undefined;

    // リハーサルマーク（練習番号）: <direction-type><rehearsal> を拾う
    // 練習番号は段に1つ。五線で分けたとき両手へ二重に付かないよう、1番目の五線ぶんだけ拾う
    const rehearsalEl = staffNumber === null || staffNumber === 1
      ? measureEl.querySelector('direction-type rehearsal')
      : null;
    const rehearsalText = rehearsalEl?.textContent?.trim();
    const rehearsalMark = rehearsalText && rehearsalText.length > 0 && rehearsalText.length <= 4
      ? rehearsalText
      : undefined;

    // 速度標語（Andante 等）: <direction-type><words> を拾う（Issue #518）。
    // <words> は速度標語だけでなく発想標語（dolce 等）や任意の注釈にも使われる汎用要素なので、
    // 「対応表（tempoMarkingPresets）にある語」だけを速度標語として取り込む。
    // こうしないと dolce のような表示専用の語まで再生テンポを動かしてしまう。
    // リハーサルマークと同じ理由で、五線で分けた譜では1番目の五線ぶんだけ拾う（両手に二重に付けない）
    // 発想標語（dolce）の後に速度標語（Andante）が並ぶ場合に前者で止まらないよう、
    // 小節内の <words> を全部見て「対応表にある最初の語」を採る（Codex round1 P2）
    const tempoWordsEl = staffNumber === null || staffNumber === 1
      ? Array.from(measureEl.querySelectorAll('direction-type words')).find(
          (el) => getTempoMarkingBpm(el.textContent?.trim() ?? '') != null,
        )
      : null;
    const tempoMarking = tempoWordsEl?.textContent?.trim() || undefined;
    // 標語を付ける音符の位置: その direction より手前にある主声部の音符
    // （<chord/> の和音構成音・イベント化されない <grace> は数えない）の個数
    // ＝ 標語イベントのインデックス。自分の書き出し（イベントごとに <direction> を
    // 音符の直前へ挟む形）を正しく往復させるための概算で、<backup> 後の追加声部領域に
    // 置かれた標語は末尾へクランプされる。
    // 五線分割（大譜表）の読み込みでは、別五線の音の時間を合成休符で埋めるため
    // 生XML上の音符数と events のインデックスが一致しない（round2 P2）。その場合は
    // 位置復元をあきらめて従来どおり先頭へ付ける
    let tempoMarkingEventIndex = 0;
    if (tempoWordsEl && staffNumber === null) {
      const dirEl = tempoWordsEl.closest('direction');
      let count = 0;
      for (const child of Array.from(measureEl.children)) {
        if (child === dirEl) break;
        if (child.tagName === 'backup') break; // 追加声部領域に入ったら主声部の位置は確定
        if (child.tagName === 'note' && !child.querySelector('chord') && !child.querySelector('grace')) {
          count += 1;
        }
      }
      tempoMarkingEventIndex = count;
    }

    // 小節単位拍子変更
    const attrEl = measureEl.querySelector('attributes time');
    let timeSig: [number, number] | undefined;
    if (attrEl) {
      const b = parseInt(attrEl.querySelector('beats')?.textContent ?? '', 10);
      const bt = parseInt(attrEl.querySelector('beat-type')?.textContent ?? '', 10);
      // 同じ拍子の書き直しは「変更」として取り込まない（上の runningTimeSig 参照）
      if (!isNaN(b) && !isNaN(bt) && isValidTimeSignature([b, bt])
        && (b !== runningTimeSig[0] || bt !== runningTimeSig[1])) {
        timeSig = [b, bt];
        runningTimeSig = [b, bt];
      }
    }

    // 小節単位調号変更（先頭小節はグローバル調号として別に扱うため、2小節目以降のみ拾う）。
    // 同じ調号の書き直しは「変更」として取り込まない（上の runningKeyFifths 参照）
    let measureKeySig: KeySignature | undefined;
    {
      const keyEl = measureEl.querySelector('key fifths');
      if (keyEl) {
        const fifths = parseInt(keyEl.textContent ?? '', 10);
        if (!isNaN(fifths) && fifths >= -7 && fifths <= 7 && fifths !== runningKeyFifths) {
          const ks = FIFTHS_TO_KEY[fifths];
          if (ks && isValidKeySignature(ks)) {
            if (mi > 0) measureKeySig = ks;
            runningKeyFifths = fifths;
          }
        }
      }
    }

    // 途中クレフ変更の取り込み（#453）。書き出し側（musicXmlExport.ts）は
    // 「小節単位の変更＝小節頭の <attributes><clef>」「小節途中の変更＝対象の音符の直前の
    // <attributes><clef>」で出しているので、その両方をここで元のデータ形へ戻す。
    const { headClef, midClefs } = collectMeasureClefs(measureEl, staffNumber, divisions);
    // 小節の頭のクレフは、前の小節の末尾時点と違うときだけ小節単位の変更として保存する
    // （毎小節クレフを書き直す書き出し元でも、変更が無ければ何も足さない）
    const headCandidate = headClef ?? carriedClef;
    carriedClef = null;
    let measureClef: ClefType | undefined;
    if (headCandidate && headCandidate !== runningClef) {
      measureClef = headCandidate;
      runningClef = headCandidate;
    }
    if (midClefs.length > 0) {
      // 主声部イベントの開始拍を先に積算しておき、クレフの拍位置と突き合わせる
      const startBeats: number[] = [];
      let acc = 0;
      for (const ev of events) {
        startBeats.push(acc);
        acc += getEventDurationBeats(ev);
      }
      // <backup> で戻った下声側に書かれたクレフは、文書順では拍位置の前後が入れ替わり得る。
      // クレフの効き方は「時間順」なので、拍位置で安定ソートしてから適用する（round1 P1）
      const orderedMidClefs = [...midClefs].sort((a, b) => a.beat - b.beat);
      for (const { beat, clef } of orderedMidClefs) {
        // その時刻以降に始まる最初の音（＝小型クレフを手前に置く音）へ結び付ける。
        // 音が伸びている途中に書かれたクレフは、次に始まる音から有効になる
        const at = startBeats.findIndex((b) => b >= beat - BEAT_EPSILON);
        if (at < 0) {
          // 最後の音より後ろ＝小節末尾の予告クレフ。次の小節の頭から有効にする。
          // 比較相手は「現時点の末尾状態」（すでに予告があればそれ）。予告後にさらに
          // 変更が続く（treble→bass→treble 等）と、単純な runningClef 比較では
          // 最後の変更を念押しと誤判定して bass のまま持ち越してしまう（round1 P1）
          if (clef !== (carriedClef ?? runningClef)) carriedClef = clef;
          continue;
        }
        if (clef === runningClef) continue; // すでに有効なクレフの念押し表記は取り込まない
        // v1 は主声部のイベントにだけ clefChange を持たせる（追加声部にも持たせると、
        // 同じ時刻に声部ごとの別クレフを主張できてしまう）。clefChange は
        // 「このイベントの直前に小型クレフを置き、このイベントから有効」の意味
        events[at] = { ...events[at], clefChange: clef };
        runningClef = clef;
      }
    }

    // 速度標語は「音符に付く文字列」として持つ（#458 の持ち方に合わせる）。
    // 位置は書き出し時の並び（direction が対象音符の直前）から復元した概算インデックス。
    // 範囲外（追加声部領域の標語など）は末尾へクランプする。
    // 音符が1つも無い小節では置き場所が無いので、その場合は捨てる（表示・再生とも影響なし）
    if (tempoMarking && events.length > 0) {
      const at = Math.min(tempoMarkingEventIndex, events.length - 1);
      events[at] = { ...events[at], tempoMarking };
    }

    return {
      events: events.length ? events : [{ dur: '1', isRest: true, keys: [] }],
      // 追加声部: 入力があった小節だけ voices を持たせる。
      // voiceMeasureUtils の withVoiceEventsUpdated と同じ形（声部2以降は既定で符幹下向き）に揃える。
      voices: (voice2Events.length > 0 || extraVoiceEvents.some((ve) => ve.length > 0))
        ? [
            { id: 'voice-1', events: events.length ? events : [{ dur: '1', isRest: true, keys: [] }] },
            { id: 'voice-2', events: voice2Events, stemDirection: 'down' as const },
            ...extraVoiceEvents.map((ve, i) => ({ id: `voice-${i + 3}`, events: ve, stemDirection: 'down' as const })),
          ]
        : undefined,
      repeatStart: leftBarline?.getAttribute('direction') === 'forward' ? true : undefined,
      repeatEnd: rightBarline?.getAttribute('direction') === 'backward' ? true : undefined,
      bpm: bpm && !isNaN(bpm) ? bpm : undefined,
      timeSignature: timeSig,
      keySignature: measureKeySig,
      clef: measureClef,
      rehearsalMark,
    };
  });
}

/** MusicXML の解析結果。`<defaults>` から読めたレイアウト指定も併せて返す（Issue #477）。 */
export interface MusicXmlImportResult {
  /** 譜面データ（レイアウト指定は既に score 側へ反映済み） */
  score: SavedScoreData;
  /**
   * ファイルの `<defaults>` から読み取れたレイアウト（無ければ undefined）。
   * 「ファイル指定を引き継いだ」ことを画面側が通知する（#318）ために返す。
   */
  defaults?: MusicXmlDefaultsLayout;
  /**
   * 先頭小節の（標語に併記されていない）<sound tempo> から読み取った全体テンポ（#518）。
   * このアプリの書き出しは全体テンポを先頭小節の <metronome>+<sound> として出すため、
   * 先頭小節の単独 sound は「全体テンポ」として返し、measure.bpm には入れない。
   * こうしないと往復で「全体126」が「先頭小節だけ数値126・パネルは120のまま」に化ける。
   * 正本はアプリ固有メタ（music-editer.global-bpm）。メタがあれば先頭小節の <sound> 由来の
   * bpm のうち「由来メタ（first-measure-bpm-explicit）で明示と記録されていないパート」の
   * メタ一致値だけを取り除く（明示の数値テンポ変更は値が同じでも保持する）。
   * メタの無い外部ファイルは、全パートで一致し標語より前に書かれた先頭小節の単独 <sound> を
   * 全体テンポとみなす。それ以外は従来どおり measure.bpm として保持する。
   */
  globalBpm?: number;
  /**
   * 取り込めなかった文字の強弱記号（sfz・fp・ppp など）の件数（#552）。
   * 0 件のときは undefined。黙って消さずに「N 件は取り込めませんでした」と
   * 知らせるために返す（#318）。
   */
  unsupportedDynamicsCount?: number;
  /**
   * 上限（4声/段）を超えていたため5声目以降を捨てた小節の数（#417 Codex round1 P1-4）。
   * 0 件のときは undefined。黙って捨てないために返す（#318）。
   */
  voicesOverLimitMeasureCount?: number;
}

/**
 * MusicXML 文字列を解析して、譜面データと `<defaults>` のレイアウト指定を返す。
 * @param xmlString MusicXML の文字列
 * @returns 解析結果
 * @throws パースに失敗した場合は Error をスロー
 */
export function parseMusicXmlWithDefaults(xmlString: string): MusicXmlImportResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  // パースエラーチェック（DOMParser はエラー時に parseerror 要素を返す）
  const parseError = doc.querySelector('parseerror');
  if (parseError) throw new Error(`MusicXML の解析に失敗しました: ${parseError.textContent}`);

  // score-partwise のみ対応（score-timewise は変換不要）
  const root = doc.querySelector('score-partwise');
  if (!root) throw new Error('score-partwise 形式の MusicXML のみ対応しています');

  // タイトル・作曲者。
  // タイトルは <work><work-title>（曲集全体の題）を優先しつつ、無ければ
  // <movement-title>（単一楽章の題）へフォールバックする（Issue #502）。
  // Finale は単曲書き出しで movement-title 側だけを使うため、work-title のみを
  // 見ると Finale 持ち込み（#419 系）でタイトルが空になる
  const title =
    doc.querySelector('work-title')?.textContent
    ?? doc.querySelector('movement-title')?.textContent
    ?? '';
  const composer = doc.querySelector('creator[type="composer"]')?.textContent ?? '';

  // デフォルト設定（最初の attributes から取得する）
  let globalKeyFifths = 0;
  let globalTimeSig: [number, number] = [4, 4];
  // 拍子の表示スタイル（Issue #422）。<time symbol="..."> が無ければ従来どおり数字表記
  let globalTimeSigStyle: TimeSignatureStyle = 'numeric';
  let defaultClef: ClefType = 'treble';

  // 最初のパートの最初の小節の attributes を見てグローバル設定を取得
  const firstAttrs = doc.querySelector('measure attributes');
  if (firstAttrs) {
    const fifths = parseInt(firstAttrs.querySelector('fifths')?.textContent ?? '0', 10);
    if (!isNaN(fifths) && fifths >= -7 && fifths <= 7) globalKeyFifths = fifths;

    const beats = parseInt(firstAttrs.querySelector('time beats')?.textContent ?? '4', 10);
    const beatType = parseInt(firstAttrs.querySelector('time beat-type')?.textContent ?? '4', 10);
    if (isValidTimeSignature([beats, beatType])) globalTimeSig = [beats, beatType];

    // <time symbol="common"/"cut"> が付いていれば記号表記として読み込む（Issue #422）。
    // 数字（beats / beat-type）は symbol の有無に関わらずそのまま拍子データにする。
    const timeSymbol = firstAttrs.querySelector('time')?.getAttribute('symbol');
    if (timeSymbol === 'common' || timeSymbol === 'cut') {
      globalTimeSigStyle = 'symbol';
    }

    const clefSign = firstAttrs.querySelector('clef sign')?.textContent ?? 'G';
    const clefLine = firstAttrs.querySelector('clef line')?.textContent;
    defaultClef = xmlClefToClefType(clefSign, clefLine);
  }
  {
    // アプリ固有メタ（miscellaneous-field・round3 P2）: 先頭拍子が 4/4・2/2 でない間に
    // 書き出しても記号表示の設定が往復するよう、<time symbol> とは別に自前の印も読む
    const miscStyle = Array.from(doc.querySelectorAll('identification miscellaneous-field'))
      .find((el) => el.getAttribute('name') === 'music-editer.time-signature-style')
      ?.textContent?.trim();
    if (miscStyle === 'symbol') globalTimeSigStyle = 'symbol';
  }

  const keySignature: KeySignature = FIFTHS_TO_KEY[globalKeyFifths] ?? 'C';
  const validKey = isValidKeySignature(keySignature) ? keySignature : 'C';

  // パート一覧
  const partEls = Array.from(doc.querySelectorAll('part'));
  const parts: PartData[] = [];
  // 各 PartData がどのパート（**part-list 順**の番号）から作られたか。パート単位メタは
  // part-list 順で番号付けされる（MusicXML では譜面上の順序を part-list が定義し、
  // <part> 本体の文書順は保証されない・round6 P2）。五線分割（大譜表）では
  // 1つの <part> から2つの PartData ができるため、両方へ同じ番号を記録する
  const partListIds = Array.from(doc.querySelectorAll('part-list score-part'))
    .map((el) => el.getAttribute('id'));
  // part-list と本文の id が完全対応するときだけ part-list 順で番号付けする。
  // 一部でも引けない id があると、part-list 順と文書順の番号が混在して明示メタが
  // 誤ったパートへ適用され得る（round7 P3）ため、その場合は全パートを文書順へ切り替える
  // 「完全対応」= 件数一致・id の一意性・双方向の集合一致（round8 P3）。
  // 余分な score-part や重複 id のある不正ファイルで番号がずれるのを防ぐ
  const bodyIds = partEls.map((el) => el.getAttribute('id'));
  const partListConsistent =
    partListIds.length === bodyIds.length
    && new Set(partListIds).size === partListIds.length
    && new Set(bodyIds).size === bodyIds.length
    && bodyIds.every((id) => id != null && partListIds.includes(id));
  const sourcePartElIndexByPart: number[] = [];

  for (let pi = 0; pi < partEls.length; pi++) {
    const partEl = partEls[pi];
    const partId = partEl.getAttribute('id') ?? `P${pi + 1}`;
    const scorePartEl = doc.querySelector(`score-part[id="${partId}"]`);
    const partName = scorePartEl?.querySelector('part-name')?.textContent ?? partId;

    const firstPartAttrs = partEl.querySelector('attributes');
    const measureEls = Array.from(partEl.querySelectorAll('measure'));

    // ピアノ譜の MusicXML は「1つの <part> に <staves>2</staves>」で書かれるのが主流
    // （Finale / MuseScore / OMR ツールの出力もこの形）。この場合は五線ごとに
    // PartData を分けないと、左手の音が右手の五線へ混ざって取り込まれてしまう。
    const staffCount = readStaffCount(partEl);
    // 五線分割の対象は「単独パート × 2五線」（ピアノ大譜表）だけに限定する。
    // 3五線以上（オルガン譜）や複数パート編成内の大譜表は、分割しても受け皿の
    // 譜種判定・編成復元が対応しておらず、黙ってパートが欠落する（Codex round1 P2）。
    // #318 の方針どおり、理由と代替手順を付けて読込を中止する
    if (staffCount > 2 || (staffCount === 2 && partEls.length > 1)) {
      throw new Error(
        staffCount > 2
          ? `3段以上の大譜表（${partName}: ${staffCount}段）の読み込みには未対応です。書き出し元で五線ごとに別パートへ分けてから読み込んでください`
          : `複数パート編成の中の大譜表（${partName}）の読み込みには未対応です。ピアノ単独の楽譜として書き出すか、五線ごとに別パートへ分けてから読み込んでください`,
      );
    }
    const staffNumbers: (number | null)[] = staffCount >= 2
      ? Array.from({ length: staffCount }, (_, i) => i + 1)
      : [null]; // <staves> が無い従来の「1パート1五線」はこれまでどおり分けずに読む

    for (const staffNumber of staffNumbers) {
      const staffClef = clefForStaff(firstPartAttrs, staffNumber) ?? defaultClef;
      const measures = buildStaffMeasures(measureEls, staffNumber, staffClef, globalKeyFifths, globalTimeSig);
      sourcePartElIndexByPart.push(partListConsistent ? partListIds.indexOf(partId) : pi);
      parts.push({
        partId: staffPartId(partName, staffNumber, staffCount, partEls.length),
        clef: staffClef,
        // 読込境界の実体化（#244 段5-4）: 単声部の小節は voices: undefined で組み立てられる
        // ため、ここで全小節へ voices[0] を実体化してから返す（他の読込境界と同じ扱い）
        measures: ensureMeasuresPrimaryVoiceMaterialized(
          measures.length ? measures : [{ events: [{ dur: '1', isRest: true, keys: [] }] }],
        ),
      });
    }
  }

  // score type は partの数で推定
  const scoreType = parts.length >= 4 ? 'ensemble' : parts.length === 2 ? 'piano' : 'single';

  // <defaults>（Finale などが書き出す「その作品のレイアウト」）を読む（Issue #477）。
  // 読めた項目だけを作品の属性として引き継ぎ、読めなければ従来どおりアプリの既定値で組む。
  const defaults = readMusicXmlDefaults(doc);

  // 先頭小節の sound tempo は「全体テンポ」へ読み替える（MusicXmlImportResult.globalBpm の
  // ドキュメント参照）。読み替えが再生の意味を変えないと確認できたときだけ行う。
  // 正本はアプリ固有メタ（自分の書き出しにのみ存在）。メタの無い外部ファイルは
  // フォールバックの推定で読む。
  const readMetaField = (name: string): string | undefined =>
    Array.from(doc.querySelectorAll('identification miscellaneous-field'))
      .find((el) => el.getAttribute('name') === name)
      ?.textContent?.trim();
  // メタは「完全な数値・正の範囲」だけを受理する（round4 P2）。
  // 不正なメタ（120abc・0・負数・空）は「メタが壊れている」のであって「メタが無い」のとは
  // 違うため、外部ファイル向けの推定へ落とさず、読み替え自体を行わない（bpm を保持）
  const parseMetaBpm = (text: string): number | 'invalid' => {
    if (!/^\d+$/.test(text)) return 'invalid';
    const v = parseInt(text, 10);
    return v > 0 && v <= 400 ? v : 'invalid';
  };
  let globalBpm: number | undefined;
  const metaGlobalBpmText = readMetaField('music-editer.global-bpm');
  const metaGlobalBpm = metaGlobalBpmText != null ? parseMetaBpm(metaGlobalBpmText) : undefined;
  // 先頭小節に明示の数値テンポ変更があるパート番号（書き出し順）のメタ（round4 P1 / round5 P1）。
  // 値の一致だけでは「全体テンポ由来」と断定できない（全体120+明示120+標語で、
  // 明示を消すと実効テンポが標語側へ反転する）ため、由来そのものを書き出しが記録する。
  // パート単位なのは、明示ありと無しが混在する譜で無い側だけを取り除くため。
  // 旧形式の 'true'（全パート一律）も後方互換で受ける
  const explicitMetaText = readMetaField('music-editer.first-measure-bpm-explicit');
  const explicitAllParts = explicitMetaText === 'true';
  const explicitPartElIndices = new Set(
    (explicitMetaText ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => /^\d+$/.test(t))
      .map((t) => parseInt(t, 10)),
  );
  if (metaGlobalBpmText != null) {
    if (metaGlobalBpm !== undefined && metaGlobalBpm !== 'invalid') {
      globalBpm = metaGlobalBpm;
      parts.forEach((part, partIndex) => {
        if (explicitAllParts) return;
        if (explicitPartElIndices.has(sourcePartElIndexByPart[partIndex])) return;
        const first = part.measures[0];
        if (first?.bpm === metaGlobalBpm) part.measures[0] = { ...first, bpm: undefined };
      });
    }
    // メタが不正: 読み替えなし（measure.bpm を保持）
  } else {
    // メタの無い外部ファイル: 全パートで一致する先頭小節の <sound> を全体テンポとみなす。
    // 値を持たないパートがあっても読み替えてよい: 小節テンポはスコア共通の1列として解決される
    //（#516 resolveScoreMeasureBpms）ため、どのパートに書かれていても再生結果は同じ（round3 P2）
    const firstMeasureBpms = parts
      .map((part) => part.measures[0]?.bpm)
      .filter((v): v is number => v != null);
    // 標語（対応表にある語）より後ろ（文書順）に書かれた単独 <sound> は、外部プレーヤーでは
    // 標語の目安BPMを上書きする「テンポ変更」として鳴る。全体テンポへ読み替えると
    // 標語が勝つ側に反転してしまうので、その形のファイルは読み替えない
    const firstMeasureSoundIsGlobal = partEls.every((partEl) => {
      const m = partEl.querySelector('measure');
      if (!m) return true;
      const sound = Array.from(m.querySelectorAll('sound[tempo]')).find(
        (el) => !el.closest('direction')?.querySelector('direction-type words'),
      );
      if (!sound) return true;
      const marking = Array.from(m.querySelectorAll('direction-type words')).find(
        (el) => getTempoMarkingBpm(el.textContent?.trim() ?? '') != null,
      );
      if (!marking) return true;
      return (sound.compareDocumentPosition(marking) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    if (
      firstMeasureBpms.length > 0
      && firstMeasureBpms.every((v) => v === firstMeasureBpms[0])
      && firstMeasureSoundIsGlobal
    ) {
      globalBpm = firstMeasureBpms[0];
      for (const part of parts) {
        const first = part.measures[0];
        if (first?.bpm != null) part.measures[0] = { ...first, bpm: undefined };
      }
    }
  }

  const score: SavedScoreData = {
    version: '1.0',
    timestamp: Date.now(),
    metadata: {
      title,
      subtitle: '',
      lyricist: '',
      composer,
      arranger: '',
    },
    scoreType,
    keySignature: validKey,
    timeSignature: globalTimeSig,
    timeSignatureStyle: globalTimeSigStyle,
    parts,
    systems: 6,
    measuresPerSystem: 4,
    // ファイル指定のレイアウト（読めた項目だけ）。用紙サイズは #495 の作品属性に載せる
    pageSize: defaults?.pageSize,
    notationSizeMultiplier: defaults?.notationSizeMultiplier,
    pageMargins: defaults?.pageMargins,
  };

  // 対応表に無い強弱記号は取り込まないので、その件数を画面へ返して通知させる（#552）
  const unsupportedDynamicsCount = countUnsupportedDynamics(root);
  // 上限（4声/段）を超えて捨てた声部の件数も返す（#417 Codex round1 P1-4）
  const voicesOverLimitCount = countVoicesOverLimit(root);

  return {
    score,
    defaults,
    globalBpm,
    unsupportedDynamicsCount: unsupportedDynamicsCount > 0 ? unsupportedDynamicsCount : undefined,
    voicesOverLimitMeasureCount: voicesOverLimitCount > 0 ? voicesOverLimitCount : undefined,
  };
}

/**
 * MusicXML 文字列を解析して SavedScoreData を返す（従来からの入口）。
 * レイアウト指定の通知が要らない呼び出し向けの薄いラッパー。
 */
export function parseMusicXml(xmlString: string): SavedScoreData {
  return parseMusicXmlWithDefaults(xmlString).score;
}
