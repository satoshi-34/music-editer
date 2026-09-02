import type { MeasureData, NoteEvent, TimeSignature } from '../types/storage';
import { expandMeasuresForPlayback, expandMeasuresForPlaybackWithReference, type ExpandedPlaybackMeasure } from '../audio/repeatPlaybackUtils';
import { getMeasureBeats } from './timeSignatureUtils';
import { getEventDurationBeats, getMeasureDurationBeats, getMeasureVoices, getPrimaryVoiceEvents } from './voiceMeasureUtils';
import { applySwingToTiming, shouldApplySwing } from './swingUtils';
import { resolveEffectiveMeasureBpms, resolveMeasureBpms } from './tempoPlaybackUtils';

export interface PlaybackTimelinePosition {
  measureIndex: number;
  beatPosition: number;
  noteIndex: number;
}

export interface PlaybackTimelineItem {
  atMs: number;
  position: PlaybackTimelinePosition;
  /**
   * その時刻に鳴っている音符（全パート・全声部）。画面のハイライトはこれを見て帯を出す（#411）。
   * `highlightParts` を渡さずに呼んだときは付かない（従来どおり主声部だけの位置情報になる）。
   */
  targets?: PlaybackHighlightTarget[];
}

/**
 * ハイライト1つぶんの宛先。描画側の当たり判定 rect（`.vf-note-hit` /
 * `.vf-inactive-voice-note-hit`）の `data-part` / `data-voice` / `data-measure` / `data-note`
 * とそのまま対応する（#411）。
 */
export interface PlaybackHighlightTarget {
  /** 描画側の段（パート）インデックス。DOM の data-part と一致する */
  partIndex: number;
  /** 声部インデックス（0 = 上声）。声部数の上限を決め打ちしない */
  voiceIndex: number;
  measureIndex: number;
  /** その声部のイベント列での位置。DOM の data-note と一致する */
  noteIndex: number;
}

/**
 * ハイライト対象にするパート（段）。再生に渡す前の**展開していない**小節列を渡す。
 * 反復の展開は内部で基準パートに合わせて行う（実音と同じ expandMeasuresForPlaybackWithReference）。
 */
export interface PlaybackHighlightPartSource {
  partIndex: number;
  measures: MeasureData[];
}

/** 拍位置の比較に使う許容誤差。3連符（1/3 拍）など割り切れない値の突き合わせ用 */
const BEAT_EPSILON = 1e-6;

/** 1つの声部の「鳴っている区間」1件ぶん */
interface LaneNote {
  startBeat: number;
  endBeat: number;
  noteIndex: number;
}

/** 1小節ぶんの「パート×声部」1レーン */
interface MeasureLane {
  partIndex: number;
  voiceIndex: number;
  /** ハイライト対象として DOM を探すかどうか（従来互換の呼び出しでは false） */
  emitTargets: boolean;
  notes: LaneNote[];
}

/**
 * 1つの声部のイベント列を「鳴っている区間」の一覧へ変換する。
 * 休符と空イベントは光らせないので入れない（従来の主声部の扱いと同じ）。
 */
function collectLaneNotes(events: NoteEvent[], swingActive: boolean): LaneNote[] {
  const notes: LaneNote[] = [];
  let beatPosition = 0;
  events.forEach((event, noteIndex) => {
    const durationBeats = getEventDurationBeats(event);
    if (!event.isRest && Array.isArray(event.keys) && event.keys.length > 0) {
      // 見た目のハイライトも、実際に鳴る位置（スウィング後）に合わせる
      const timing = swingActive
        ? applySwingToTiming(
            { startBeat: beatPosition, durationBeats },
            event.dur,
            event.dots,
            event.tuplet
          )
        : { startBeat: beatPosition, durationBeats };
      notes.push({
        startBeat: timing.startBeat,
        endBeat: timing.startBeat + timing.durationBeats,
        noteIndex,
      });
    }
    // 次の音符の位置は、スウィングの影響を受けない「本来の拍位置」で進める
    beatPosition += durationBeats;
  });
  return notes;
}

/** その拍で鳴っている音符（開始 <= 拍 < 終了）を返す。無ければ null */
function findSoundingNote(notes: LaneNote[], beat: number): LaneNote | null {
  for (const note of notes) {
    if (note.startBeat <= beat + BEAT_EPSILON && beat < note.endBeat - BEAT_EPSILON) return note;
  }
  return null;
}

/**
 * 再生ボタン経路用の「見た目の再生位置タイムライン」を作る。
 *
 * 実音のスケジューリングは各 PlaybackEngine が担当するが、
 * 画面側はその内部状態を直接読めない。
 * そこでここでは、譜面データから
 * 「何ミリ秒後に、どの小節の何番目の音符を光らせるか」
 * を先に計算して、UI のみで追従できるようにする。
 */
export function buildPlaybackPositionTimeline(
  measures: MeasureData[],
  bpm: number,
  timeSignature: TimeSignature,
  swingEnabled: boolean = false,
  startExpandedIndex: number = 0,
  /**
   * スコア共通の解決済みテンポ列（#458 round2 P1）。渡された場合は内部で再解決せず
   * これを使う（実音側と同じ列を共有し、他段だけに置かれた標語でもハイライトが同期する）。
   * 省略時は従来どおり自パート列から解決（単体利用・後方互換）
   */
  sharedMeasureBpms?: number[],
  /**
   * ハイライト対象の全パート（#411）。渡すと、主声部だけでなく**鳴っている全パート・全声部**の
   * 音符が `targets` に載る（選択中のレイヤーだけが光る問題の解消）。
   * 渡さないときは従来どおり、基準パートの主声部だけのタイムラインになる。
   */
  highlightParts?: PlaybackHighlightPartSource[]
): PlaybackTimelineItem[] {
  // 途中再生（#108）: 展開順の先頭 startExpandedIndex 個を丸ごと飛ばす。
  // 実音側（playParts へ渡す小節列）も同じ位置で切るため、atMs は 0 起点のままで一致する
  const expandedMeasuresFull = expandMeasuresForPlayback(measures);
  // 小節ごとのテンポ（途中テンポ変更・速度標語）は**切る前の全列**で解決する。
  // 切ってから解決すると、開始位置より前に置かれた標語やテンポ指定が失われ、
  // 途中再生のときだけハイライトが実音とズレる（強弱の解決と同じ理由・Issue #458）
  const measureBpms = sharedMeasureBpms ?? resolveMeasureBpms(expandedMeasuresFull.map((item) => item.measure), bpm);
  const sliceStart = Math.max(0, startExpandedIndex);
  const expandedMeasures = expandedMeasuresFull.slice(sliceStart);
  const timeline: PlaybackTimelineItem[] = [];

  // ハイライト対象のパートごとに、基準パート（measures）と同じ反復順へそろえた小節列を先に作る。
  // 実音側（ScorePage）が使っているのと同じ関数なので、反復・括弧のある譜面でも
  // 「同じ時刻に同じ小節」を指す（別々に展開すると2周目でパートごとにズレる）。
  const expandedPerHighlightPart = (highlightParts ?? []).map((source) => (
    source.measures === measures
      ? expandedMeasuresFull
      : expandMeasuresForPlaybackWithReference(measures, source.measures)
  ));

  // 小節ごとにテンポが変わるため、経過は「拍」ではなくミリ秒で積む。
  // 拍のまま積んで最後に1つの msPerBeat を掛けると、テンポ変更前の小節まで
  // 変更後の速さで数えてしまう
  let elapsedMs = 0;
  // 直前に光った主声部の音符番号（位置表示の連続性のために覚えておく）
  let lastReferenceNoteIndex: number | null = null;

  expandedMeasures.forEach(({ sourceMeasureIndex, measure }, sliceIndex) => {
    const msPerBeat = (60 / measureBpms[sliceStart + sliceIndex]) * 1000;
    // 小節ごとに拍子が変わる譜面では、その小節の拍子でスウィング対象かどうかを判定する。
    const measureTimeSignature = measure.timeSignature ?? timeSignature;
    const swingActiveForMeasure = shouldApplySwing(swingEnabled, measureTimeSignature);

    // ── その小節で鳴るレーン（パート×声部）を集める ──
    // 基準パートの主声部は「画面の位置表示（N小節目 M音符目）」の基準として必ず入れる。
    // highlightParts が渡されているときは、そこに載っている全パートの全声部も入れる。
    // 主声部の読みは正規アクセサ（#244 段5-3）。再生列挙と同じ源を読むことで索引・時刻を一致させる
    const referenceLane: MeasureLane = {
      partIndex: -1,
      voiceIndex: 0,
      emitTargets: false,
      notes: collectLaneNotes(getPrimaryVoiceEvents(measure), swingActiveForMeasure),
    };
    const lanes: MeasureLane[] = [referenceLane];
    (highlightParts ?? []).forEach((source, sourceIndex) => {
      const partMeasure = expandedPerHighlightPart[sourceIndex][sliceStart + sliceIndex]?.measure;
      if (!partMeasure) return;
      // スウィングの判定はそのパートの小節の拍子で行う（拍子は小節ごとに変わり得る）
      const partSwingActive = shouldApplySwing(swingEnabled, partMeasure.timeSignature ?? timeSignature);
      getMeasureVoices(partMeasure).forEach((voice, voiceIndex) => {
        lanes.push({
          partIndex: source.partIndex,
          voiceIndex,
          emitTargets: true,
          notes: collectLaneNotes(voice.events, partSwingActive),
        });
      });
    });

    // ── 光らせる時刻（拍）を決める ──
    // どれか1つの声部で音が始まる拍はすべてタイムラインの節目になる。
    // 主声部の音符だけを節目にしていた頃は、右手が休んでいるあいだ左手が鳴っても
    // 画面が動かなかった（#411 の症状）
    const tickBeats: number[] = [];
    lanes.forEach((lane) => {
      lane.notes.forEach((note) => {
        if (!tickBeats.some((beat) => Math.abs(beat - note.startBeat) < BEAT_EPSILON)) {
          tickBeats.push(note.startBeat);
        }
      });
    });
    tickBeats.sort((a, b) => a - b);

    tickBeats.forEach((beat) => {
      // 位置表示は従来どおり基準パートの主声部で数える。その拍で主声部が鳴っていなければ
      // 直前の音符の番号を保つ（他声部だけが鳴っている拍で番号が 0 へ飛ばないようにする）
      const referenceNote = findSoundingNote(referenceLane.notes, beat);
      const targets: PlaybackHighlightTarget[] = [];
      lanes.forEach((lane) => {
        if (!lane.emitTargets) return;
        const sounding = findSoundingNote(lane.notes, beat);
        if (!sounding) return;
        targets.push({
          partIndex: lane.partIndex,
          voiceIndex: lane.voiceIndex,
          measureIndex: sourceMeasureIndex,
          noteIndex: sounding.noteIndex,
        });
      });

      timeline.push({
        atMs: elapsedMs + beat * msPerBeat,
        position: {
          measureIndex: sourceMeasureIndex,
          beatPosition: beat,
          noteIndex: referenceNote ? referenceNote.noteIndex : (lastReferenceNoteIndex ?? 0),
        },
        // 従来の呼び出し（highlightParts なし）では付けない。既存の呼び出し元・テストの
        // タイムラインの形をそのまま保つため
        ...(targets.length > 0 ? { targets } : {}),
      });
      if (referenceNote) lastReferenceNoteIndex = referenceNote.noteIndex;
    });

    // 実音エンジンは各小節に measureBeats（グローバル拍子の長さ）を下限として渡されるため、
    // 表示の前進も「全声部の実長と拍子長の大きい方」でそろえる（Codex 2巡目）。
    // 未充足の小節を実長だけで進めると、ハイライトが実音より先へ走ってしまう
    elapsedMs += measureAdvanceBeats(measure, timeSignature) * msPerBeat;
  });

  return timeline;
}

/**
 * 1小節ぶんの前進拍数。実音エンジン（playParts）は measureBeats = グローバル拍子の長さを
 * 下限に小節を進めるため、タイムライン・残り時間の両方をこの共通規則でそろえる:
 * max(全声部の実長, 拍子の長さ)。空小節は拍子ぶん、あふれた小節は実長で進む。
 */
function measureAdvanceBeats(measure: MeasureData, timeSignature: TimeSignature): number {
  return Math.max(getMeasureDurationBeats(measure), getMeasureBeats(timeSignature));
}

/** 小節番号の指定を受け付けられなかった理由（#545。通知文の出し分けに使う） */
export type PlaybackStartMeasureRejection =
  /** 数字として読めない（空欄・記号だけ など） */
  | 'notANumber'
  /** 1 未満、または総小節数を超えている */
  | 'outOfRange'
  /** そもそも再生できる小節が無い（まだ何も入力していない譜面） */
  | 'noMeasures';

/** 小節番号の解決結果。成功なら 0 始まりの小節インデックスを返す */
export type PlaybackStartMeasureResolution =
  | { ok: true; measureIndex: number }
  | { ok: false; reason: PlaybackStartMeasureRejection };

/**
 * 途中再生（#108）の開始位置: 指定の小節が「展開後の再生順」で最初に現れる位置を返す。
 * リピートのある譜面では同じ小節が複数回鳴るため、「最初の出現から」を仕様とする
 * （2周目のどこか、を選ぶ UI は持たない）。見つからない場合は、その小節以降で
 * 最初に現れる小節（すべて手前なら 0 = 先頭）へ倒す。
 */
export function findPlaybackStartExpandedIndex(
  expandedMeasures: ExpandedPlaybackMeasure[],
  startMeasureIndex: number
): number {
  const exact = expandedMeasures.findIndex((item) => item.sourceMeasureIndex === startMeasureIndex);
  if (exact >= 0) return exact;
  const after = expandedMeasures.findIndex((item) => item.sourceMeasureIndex > startMeasureIndex);
  return after >= 0 ? after : 0;
}

/**
 * 小節番号を指定した途中再生（#545）で、入力欄の文字列を「再生開始の小節インデックス」へ解決する。
 *
 * 画面には 1 始まりの小節番号（「3小節目」）を出しているが、内部の配列は 0 始まりなので
 * ここで 1 つずらす。受け付けられない入力は理由（reason）を返し、呼び出し側が
 * 「行き止まりは喋る」（#318）の通知文へ変換する。黙って無視しないための戻り値。
 *
 * @param input 入力欄の生の文字列（前後の空白は無視する）
 * @param totalMeasureCount 指定できる小節数の上限（内容のある小節数）
 */
export function resolvePlaybackStartMeasureNumber(
  input: string,
  totalMeasureCount: number
): PlaybackStartMeasureResolution {
  if (totalMeasureCount <= 0) {
    return { ok: false, reason: 'noMeasures' };
  }

  const trimmed = input.trim();
  // 数字だけ（先頭の + / - は符号として許す）かを先に見る。parseInt は "3abc" を 3 と
  // 読んでしまうため、そのまま使うと打ち間違いを黙って受け入れてしまう
  if (!/^[+-]?\d+$/.test(trimmed)) {
    return { ok: false, reason: 'notANumber' };
  }

  const measureNumber = Number.parseInt(trimmed, 10);
  if (measureNumber < 1 || measureNumber > totalMeasureCount) {
    return { ok: false, reason: 'outOfRange' };
  }

  // 表示番号 → 実インデックスの対応はこの1か所に集約している。
  // 現在の main は弱起（#473）未実装で表示番号は常に1始まり（=インデックス+1）。
  // 弱起（表示番号0始まり）が入るときは、#473 側でこの対応だけを差し替えること
  //（getDisplayedMeasureNumber の逆引き。呼び出し側に -1 を散らさない）
  return { ok: true, measureIndex: measureNumber - 1 };
}

/**
 * すでに展開済み（リピートを再生順へ並べ替え済み）の小節列の再生時間（ms）を数える。
 * 再生ボタン経路の終了タイマーは、途中再生・先頭からの全再生とも、実際にエンジンへ渡す
 * 展開済み列をこの関数で数える（展開を内包していた旧 calculateScoreDuration は、
 * 展開済み列を渡すとリピートを二重解釈するうえ、未充足小節・声部2のみの譜面で
 * 実音より早く停止するため廃止した。#108 Codex round1〜3）。
 *
 * 前進規則は buildPlaybackPositionTimeline と共通（measureAdvanceBeats =
 * max(全声部の実長, 拍子の長さ)。実音エンジンの「拍子長を下限に進む」挙動に一致）。
 * 末尾の「全声部が空」の小節は再生対象がないため数えない（声部2だけの小節は演奏対象。Codex round1 P1）
 */
export function calculateExpandedPlaybackDurationMs(
  measures: MeasureData[],
  bpm: number,
  timeSignature: TimeSignature,
): number {
  let lastUsedIndex = -1;
  for (let i = measures.length - 1; i >= 0; i--) {
    if (getMeasureDurationBeats(measures[i]) > 0) {
      lastUsedIndex = i;
      break;
    }
  }
  if (lastUsedIndex < 0) return 0;
  // 小節ごとのテンポで数える（Issue #458）。渡ってくるのは「実際にエンジンへ渡す
  // 展開済み・切り出し済みの列」で、各小節には解決済みの bpm が載っている。
  // 載っていない小節は引数の全体テンポで数える（後方互換）。
  // ここへ渡る bpm は再生速度（%）適用後の実効値なので、譜面用の 30〜240 ではなく
  // 実効範囲（clampEffectiveBpm）で解決する（#544 round1 P1: 25%・200% で
  // 終了タイマーだけ元の速さに戻り、実音より早く/遅く stopped になっていた）
  const measureBpms = resolveEffectiveMeasureBpms(measures, bpm);
  let totalMs = 0;
  for (let i = 0; i <= lastUsedIndex; i++) {
    const msPerBeat = (60 / measureBpms[i]) * 1000;
    totalMs += measureAdvanceBeats(measures[i], timeSignature) * msPerBeat;
  }
  return totalMs;
}
