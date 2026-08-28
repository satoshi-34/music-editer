// src/utils/musicXmlImport.ts
// MusicXML ファイルを SavedScoreData 形式にパースする。
// score-partwise 形式（Finale / Sibelius / MuseScore 等が出力する標準形式）に対応。

import type { SavedScoreData, MeasureData, NoteEvent, PartData, HairpinMark, TimeSignatureStyle } from '../types/storage';
import { defaultRestDisplayKeyForDuration, type ClefType } from '../components/clefUtils';
import type { KeySignature } from './noteKeyUtils';
import { isValidKeySignature } from './noteKeyUtils';
import { isValidTimeSignature } from './timeSignatureUtils';
import { ensureMeasuresPrimaryVoiceMaterialized } from './voiceMeasureUtils';
import { ensembleSecondStaffPartId } from './instrumentationPartUtils';
import { buildRestEventsForBeats } from './measureRestFillUtils';

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
  let runId: string | null = null;
  let runRatio: string | null = null;
  let runCount = 0;
  let runDur: string | null = null; // 均一音価判定用（音価+付点数）。混在したら null のまま固定
  let runMixed = false;
  let inExplicitGroup = false; // start〜stop の間は個数カットを無効化（明示境界を最優先）
  const closeRun = () => { runId = null; runRatio = null; runCount = 0; runDur = null; runMixed = false; inExplicitGroup = false; };
  for (const el of Array.from(measureEl.children)) {
    if (el.tagName === 'backup' || el.tagName === 'forward') { closeRun(); continue; }
    if (el.tagName !== 'note') continue;
    if (el.querySelector('grace') || el.querySelector('chord')) continue;
    const timeModEl = el.querySelector('time-modification');
    if (!timeModEl) { closeRun(); continue; }
    const actualNotes = parseInt(timeModEl.querySelector('actual-notes')?.textContent ?? '', 10);
    const normalNotes = parseInt(timeModEl.querySelector('normal-notes')?.textContent ?? '', 10);
    if (!Number.isInteger(actualNotes) || actualNotes <= 0 || !Number.isInteger(normalNotes) || normalNotes <= 0) {
      closeRun();
      continue;
    }
    const marks = Array.from(el.querySelectorAll('notations tuplet')).map((t) => t.getAttribute('type'));
    const ratio = `${actualNotes}/${normalNotes}`;
    const durKey = `${el.querySelector('type')?.textContent ?? ''}:${Array.from(el.children).filter((c) => c.tagName === 'dot').length}`;
    const countCut = !inExplicitGroup && !runMixed && runCount >= actualNotes;
    if (marks.includes('start') || !runId || ratio !== runRatio || countCut) {
      tupletGroupCounter += 1;
      runId = `xml-tuplet-${tupletGroupCounter}`;
      runRatio = ratio;
      runCount = 0;
      runDur = durKey;
      runMixed = false;
      inExplicitGroup = marks.includes('start');
    } else if (durKey !== runDur) {
      runMixed = true;
    }
    idOf.set(el, runId);
    runCount += 1;
    // stop はこの音**まで**がグループ（次の音から新グループ）
    if (marks.includes('stop')) closeRun();
  }
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

/**
 * 松葉（ヘアピン）を1つの声部の NoteEvent へ復元する。
 * 書出側（musicXmlExport.ts）は
 * 「開始音符の直前に <direction><wedge type="crescendo|diminuendo"/></direction>」
 * 「終了音符の直後に <direction><wedge type="stop"/></direction>」
 * という並びで出力しているため、<measure> の直下の子要素（note と direction）を
 * 出現順に読み、直前/直後の note との対応を追いながら組み立てる。
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
function attachHairpinsToVoiceEvents(
  children: Element[],
  events: NoteEvent[],
  measureIndex: number,
  openRefs: HairpinMark[],
  syntheticRestCount?: (el: Element) => number,
): void {
  let eventIndex = -1;
  let pendingTypes: Array<'cresc' | 'dim'> = [];

  for (const child of children) {
    if (child.tagName === 'direction') {
      const wedgeType = child.querySelector('wedge')?.getAttribute('type');
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
    if (pendingTypes.length === 0) continue;
    const ev = events[eventIndex];
    if (!ev) continue;
    for (const type of pendingTypes) {
      const mark: HairpinMark = { type, endMeasure: measureIndex, endEvent: eventIndex };
      ev.hairpins = [...(ev.hairpins ?? []), mark];
      openRefs.push(mark);
    }
    pendingTypes = [];
  }
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
function buildStaffMeasures(measureEls: Element[], staffNumber: number | null, staffClef: ClefType): MeasureData[] {
  // 松葉（ヘアピン）は小節をまたぐ場合があるため、パート全体で1つの待ち行列を使い回す。
  // 声部1と声部2で別々に持つのは、<backup> を挟んで別々の松葉が同時に開くことがあるため。
  const openHairpinRefs: HairpinMark[] = [];
  const openHairpinRefsVoice2: HairpinMark[] = [];
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
    attachHairpinsToVoiceEvents(voice1Children, events, mi, openHairpinRefs, syntheticRestCount);

    const voice2Events = parseVoiceChildren(voice2Children);
    // 声部2の松葉も同じ方式で復元する（voice2Events の要素を直接書き換える）
    attachHairpinsToVoiceEvents(voice2Children, voice2Events, mi, openHairpinRefsVoice2, syntheticRestCount);

    // 声部3以降（松葉の復元は現行 UI が2声までなので行わない。「壊れず全声部が戻る」水準）。
    // 疎な番号（間の声部が空）は空の器で埋め、声部番号を保存データ上の位置と一致させる
    const noteBearingVoiceNumbers = sectionsWithVoice
      .filter((s) => s.children.some((el) => el.tagName === 'note'
        && (staffNumber === null || noteUnitStaff(el) === staffNumber)))
      .map((s) => s.voiceNumber);
    const maxVoiceNumber = noteBearingVoiceNumbers.length > 0 ? Math.max(...noteBearingVoiceNumbers) : 1;
    const extraVoiceEvents: NoteEvent[][] = [];
    for (let n = 3; n <= maxVoiceNumber; n++) {
      extraVoiceEvents.push(parseVoiceChildren(childrenForVoice(n)));
    }

    // リピート
    const leftBarline = measureEl.querySelector('barline[location="left"] repeat');
    const rightBarline = measureEl.querySelector('barline[location="right"] repeat');

    // 小節単位テンポ（sound/@tempo があれば取得）
    const soundEl = measureEl.querySelector('sound[tempo]');
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

    // 小節単位拍子変更
    const attrEl = measureEl.querySelector('attributes time');
    let timeSig: [number, number] | undefined;
    if (attrEl) {
      const b = parseInt(attrEl.querySelector('beats')?.textContent ?? '', 10);
      const bt = parseInt(attrEl.querySelector('beat-type')?.textContent ?? '', 10);
      if (!isNaN(b) && !isNaN(bt) && isValidTimeSignature([b, bt])) {
        timeSig = [b, bt];
      }
    }

    // 小節単位調号変更（先頭小節はグローバル調号として別に扱うため、2小節目以降のみ拾う）
    let measureKeySig: KeySignature | undefined;
    if (mi > 0) {
      const keyEl = measureEl.querySelector('key fifths');
      if (keyEl) {
        const fifths = parseInt(keyEl.textContent ?? '', 10);
        if (!isNaN(fifths) && fifths >= -7 && fifths <= 7) {
          const ks = FIFTHS_TO_KEY[fifths];
          if (ks && isValidKeySignature(ks)) measureKeySig = ks;
        }
      }
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
      rehearsalMark,
    };
  });
}

/**
 * MusicXML 文字列を解析して SavedScoreData を返す。
 * @param xmlString MusicXML の文字列
 * @returns 解析結果
 * @throws パースに失敗した場合は Error をスロー
 */
export function parseMusicXml(xmlString: string): SavedScoreData {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  // パースエラーチェック（DOMParser はエラー時に parseerror 要素を返す）
  const parseError = doc.querySelector('parseerror');
  if (parseError) throw new Error(`MusicXML の解析に失敗しました: ${parseError.textContent}`);

  // score-partwise のみ対応（score-timewise は変換不要）
  const root = doc.querySelector('score-partwise');
  if (!root) throw new Error('score-partwise 形式の MusicXML のみ対応しています');

  // タイトル・作曲者
  const title = doc.querySelector('work-title')?.textContent ?? '';
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
      const measures = buildStaffMeasures(measureEls, staffNumber, staffClef);
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

  return {
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
  };
}
