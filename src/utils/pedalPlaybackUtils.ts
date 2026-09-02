// src/utils/pedalPlaybackUtils.ts
// ペダル記号（Ped … ✱）を再生へ反映するための計画づくり（Issue #549）。
//
// 実際のピアノでは、ダンパーペダルを踏んでいる間の音は音価を過ぎても鳴り続け、
// ペダルを離した瞬間に減衰する。この実装でもそれに合わせて
// 「その区間で発音した音の**鳴り終わりだけ**をペダル解除位置まで延ばす」。
// 開始時刻・音価データ・小節送りは一切変えない（#525 の「切る側だけ動かす」原則と同じ）。
//
// 記号のデータモデル（NoteEvent.pedalMark = 'down' | 'up' の単発マーク）は変えず、
// 描画側（pedalBridgeUtils.pairPedalMarks）と**同じペアリング規則**で区間を作る。
// ここでペアリングを書き直すと、破線の見た目と鳴り方が食い違う原因になる。

import type { MeasureData } from '../types/storage';
import { getEventDurationBeats, getMeasureVoices } from './voiceMeasureUtils';
import { pairPedalMarks } from './pedalBridgeUtils';
import { buildTiePlaybackEventKey } from './tiePlaybackUtils';

/**
 * 計画を引くためのキー（`小節:声部:イベント`）。
 * タイの計画（tiePlaybackUtils）と同じ物差しなので、キー生成そのものを共用する
 * （同じ形のキーを2か所で組み立てると、片方だけ直したときに静かにズレるため）。
 */
export { buildTiePlaybackEventKey as buildPedalPlaybackEventKey };

/** ペダル区間（再生タイムライン上の絶対拍。4分音符 = 1拍） */
export interface PedalInterval {
  /** 踏んだ位置（Ped の音符の開始拍） */
  downBeat: number;
  /** 離した位置（✱ の音符の開始拍） */
  upBeat: number;
}

/**
 * 1パートぶんのペダル延長計画。
 * キーは buildPedalPlaybackEventKey（`小節:声部:イベント`）、
 * 値は「そのイベントの音価の後ろへ何拍ぶん足すか」をキー（"e/4" 形式の音高）ごとに持つ。
 *
 * 和音の一部だけが先に打ち直される（同音の再打鍵）ことがあるため、
 * タイ（tieExtendBeatsByKey）と同じくキー単位で持つ。
 */
export type PedalPlaybackPlan = Map<string, Record<string, number>>;

/** 計画を作るときの1パート分の入力 */
export interface PedalPlaybackPartSource {
  /**
   * 同じ楽器のパートをまとめるためのキー。
   * ピアノの大譜表は右手・左手が別パートとして再生されるが、ペダルは楽器に1つなので、
   * 同じキーのパートに置かれた記号は互いのパートへも効かせる
   * （左手側に置いた Ped. で右手の音も伸びるのが実機どおり）。
   */
  instrumentKey: string;
  /** 反復展開済み・再生順に並んだ小節列（ScorePage がエンジンへ渡すのと同じ列） */
  measures: ReadonlyArray<MeasureData>;
}

/**
 * ペダルで同時に保持する音数の上限（1パートあたり）。
 * ペダルを長く踏んだままの曲では鳴り続ける音が積み上がり、
 * 合計音量が振り切れて歪む（クリップ）ため、超えた分は古い音から解放する。
 * 上限に達したときは「新しい音が鳴り始めた位置」で古い音を切る＝実機でも
 * 響きが飽和して古い成分から埋もれていくので、耳の印象としても近い。
 */
export const MAX_PEDAL_HELD_NOTES_PER_PART = 24;

/** 拍位置の比較で使う許容誤差（浮動小数の丸め対策） */
const BEAT_EPSILON = 0.0001;

type SoundingNote = {
  /** 計画に書き戻すための位置（`小節:声部:イベント`） */
  planKey: string;
  key: string;
  /** 記譜どおりの鳴り終わり（絶対拍）。延長ぶんの拍数はここからの差で求める */
  notatedEndBeat: number;
  /** ペダルで延ばしたあとの鳴り終わり（絶対拍） */
  endBeat: number;
};

type TimelineEvent = {
  planKey: string;
  /** 再生タイムライン上の開始拍 */
  startBeat: number;
  /** 記譜どおりの鳴り終わり（絶対拍） */
  notatedEndBeat: number;
  keys: string[];
  isRest: boolean;
  pedalMark?: 'down' | 'up';
};

/**
 * 1パートの小節列を「絶対拍つきのイベント列」へ並べ直す。
 *
 * 小節の進み方は再生エンジンと同じ「内容の実長と拍子長の大きい方」。
 * ここを揃えないと、入力途中の未充足小節がある譜面でペダル区間の位置だけがずれる。
 */
function buildTimeline(
  measures: ReadonlyArray<MeasureData>,
  measureBeatsFloor: number,
): { events: TimelineEvent[]; totalBeats: number; tieContinuationKeys: Map<string, Set<string>> } {
  const timeline: TimelineEvent[] = [];
  // タイの継続音（前の音から結ばれている側）。planKey → 結ばれている音高の集合。
  // 再打鍵判定から除外するために使う（round1 P1: 継続音を再打鍵と誤認すると、
  // ペダル保持がタイ終端で切れてしまう）
  const tieContinuationKeys = new Map<string, Set<string>>();
  const markContinuation = (planKey: string, key: string) => {
    const set = tieContinuationKeys.get(planKey) ?? new Set<string>();
    set.add(key);
    tieContinuationKeys.set(planKey, set);
  };
  let measureStartBeat = 0;

  measures.forEach((measure, measureIndex) => {
    let maxVoiceBeats = 0;
    getMeasureVoices(measure).forEach((voice, voiceIndex) => {
      let cursor = 0;
      const events = voice.events ?? [];
      events.forEach((event, eventIndex) => {
        const durationBeats = getEventDurationBeats(event);
        timeline.push({
          planKey: buildTiePlaybackEventKey(measureIndex, voiceIndex, eventIndex),
          startBeat: measureStartBeat + cursor,
          notatedEndBeat: measureStartBeat + cursor + durationBeats,
          keys: event.keys ?? [],
          isRest: !!event.isRest,
          pedalMark: event.pedalMark,
        });
        cursor += durationBeats;
        // タイの継続先を記録する（tiePlaybackUtils と同じ2形式: arcs kind='tie' と
        // 旧形式 tiedToNext=「同じ声部のすぐ次の音へ同音でタイ」）
        (event.arcs ?? []).forEach((arc) => {
          if (arc.kind !== 'tie') return;
          markContinuation(
            buildTiePlaybackEventKey(arc.toMeasureIndex, voiceIndex, arc.toEventIndex),
            arc.toKey,
          );
        });
        if ((event as { tiedToNext?: boolean }).tiedToNext) {
          const nextInVoice = eventIndex + 1 < events.length
            ? buildTiePlaybackEventKey(measureIndex, voiceIndex, eventIndex + 1)
            : buildTiePlaybackEventKey(measureIndex + 1, voiceIndex, 0);
          (event.keys ?? []).forEach((key) => markContinuation(nextInVoice, key));
        }
      });
      maxVoiceBeats = Math.max(maxVoiceBeats, cursor);
    });
    measureStartBeat += Math.max(maxVoiceBeats, measureBeatsFloor);
  });

  // 複数声部では声部ごとに積み上げるので、時系列順に並べ直してから使う。
  timeline.sort((left, right) => left.startBeat - right.startBeat);
  // totalBeats は「小節送りを含む再生タイムラインの終端」。イベントの最大終端では
  // なく小節の積算で数える（round1 P2: 段の最後のイベントで終わる扱いにすると、
  // 空小節や他段だけが続く譜面で単独 Ped の終端が早まる）
  return { events: timeline, totalBeats: measureStartBeat, tieContinuationKeys };
}

/**
 * 時系列に並んだイベント列から、ペダル区間（down → up）を取り出す。
 * 対応する up が無い down は「そのパートの終わりまで踏みっぱなし」として扱う
 * （描画では単独の Ped と表示される状態。鳴り方も見た目どおり伸ばす）。
 */
function collectIntervalsFromMarks(
  marks: Array<{ mark: 'down' | 'up'; beat: number }>,
  timelineEndBeat: number,
): PedalInterval[] {
  const intervals = pairPedalMarks(marks).flatMap((result): PedalInterval[] => {
    if (result.kind === 'bridge') {
      return result.up.beat > result.down.beat
        ? [{ downBeat: result.down.beat, upBeat: result.up.beat }]
        : [];
    }
    if (result.kind === 'down') {
      // 対応する ✱ が無い Ped は、譜面の終わりまで踏み続けている扱い。
      return timelineEndBeat > result.down.beat
        ? [{ downBeat: result.down.beat, upBeat: timelineEndBeat }]
        : [];
    }
    // 単独の ✱（踏む前の解除）は区間を作らない
    return [];
  });
  // ペダルは楽器に1つなので、区間は重ならない。連続した Ped（down, down, …）では
  // 前の区間を次の Ped 位置で終える=踏み替え（round1 P2: 単独 down を終端まで伸ばすと
  // 後続の ✱ が実質効かなくなる。リピート展開で Ped…||:…Ped…✱ になった場合も同じ）
  intervals.sort((a, b) => a.downBeat - b.downBeat);
  for (let i = 0; i + 1 < intervals.length; i++) {
    intervals[i].upBeat = Math.min(intervals[i].upBeat, intervals[i + 1].downBeat);
  }
  return intervals.filter((interval) => interval.upBeat > interval.downBeat);
}

/** その位置がどのペダル区間の中か（区間外なら null） */
function findIntervalFor(intervals: PedalInterval[], beat: number): PedalInterval | null {
  for (const interval of intervals) {
    // 区間の開始位置ちょうどで鳴った音は「踏んだ瞬間の音」として含める。
    // 解除位置ちょうどで鳴る音は、もうペダルが上がっているので含めない。
    if (beat >= interval.downBeat - BEAT_EPSILON && beat < interval.upBeat - BEAT_EPSILON) {
      return interval;
    }
  }
  return null;
}

/**
 * ペダル記号を「音の鳴り終わりを何拍ぶん延ばすか」の計画へ変換する。
 *
 * 同じ楽器（instrumentKey が同じ）のパートは1つのペダルを共有するものとして、
 * 記号をまとめてから各パートへ適用する。戻り値は入力 parts と同じ並び。
 *
 * @param parts 反復展開済み・再生順の小節列（パートごと）
 * @param measureBeatsFloor 各小節が最低限占める拍数（拍子ぶん。エンジンの小節送りと同じ物差し）
 */
export function buildPedalPlaybackPlans(
  parts: ReadonlyArray<PedalPlaybackPartSource>,
  measureBeatsFloor: number,
): PedalPlaybackPlan[] {
  const timelines = parts.map((part) => buildTimeline(part.measures, measureBeatsFloor));

  // 楽器ごとに**生のマーク**を集約してから、楽器単位で一度だけペアリングする
  //（round1 P1: 段ごとに先にペアリングすると、左手の Ped と右手の ✱ が
  // ペアにならず「左手は終端まで・右手の ✱ は無視」になる）。
  const marksByInstrument = new Map<string, Array<{ mark: 'down' | 'up'; beat: number }>>();
  const endBeatByInstrument = new Map<string, number>();
  parts.forEach((part, partIndex) => {
    const { events, totalBeats } = timelines[partIndex];
    endBeatByInstrument.set(
      part.instrumentKey,
      Math.max(endBeatByInstrument.get(part.instrumentKey) ?? 0, totalBeats),
    );
    const marks = marksByInstrument.get(part.instrumentKey) ?? [];
    events.forEach((event) => {
      if (event.pedalMark) marks.push({ mark: event.pedalMark, beat: event.startBeat });
    });
    marksByInstrument.set(part.instrumentKey, marks);
  });
  const intervalsByInstrument = new Map<string, PedalInterval[]>();
  marksByInstrument.forEach((marks, instrumentKey) => {
    if (marks.length === 0) return;
    marks.sort((a, b) => a.beat - b.beat);
    const intervals = collectIntervalsFromMarks(marks, endBeatByInstrument.get(instrumentKey) ?? 0);
    if (intervals.length > 0) intervalsByInstrument.set(instrumentKey, intervals);
  });

  return parts.map((part, partIndex) => {
    const plan: PedalPlaybackPlan = new Map();
    const intervals = intervalsByInstrument.get(part.instrumentKey);
    if (!intervals || intervals.length === 0) {
      // ペダル記号が無い譜面では空の計画を返す＝従来どおりの再生（回帰なし）
      return plan;
    }

    const { events: timeline, tieContinuationKeys } = timelines[partIndex];
    // ペダルで鳴り続けている音の台帳。同音の再打鍵と同時保持数の上限に使う。
    let holding: SoundingNote[] = [];

    /** 台帳の音の「延ばす拍数」を計画へ書き込む（0拍以下なら書かない＝従来どおりの長さ） */
    const writeExtend = (note: SoundingNote) => {
      const extendBeats = note.endBeat - note.notatedEndBeat;
      const current = plan.get(note.planKey);
      if (extendBeats <= BEAT_EPSILON) {
        if (current) delete current[note.key];
        return;
      }
      if (current) {
        current[note.key] = extendBeats;
      } else {
        plan.set(note.planKey, { [note.key]: extendBeats });
      }
    };

    /** 台帳の音を指定位置で切り、短くなった長さで計画を上書きする */
    const release = (note: SoundingNote, atBeat: number) => {
      note.endBeat = Math.min(note.endBeat, atBeat);
      writeExtend(note);
    };

    timeline.forEach((event) => {
      if (event.isRest || event.keys.length === 0) return;

      // 既に鳴り終わった音は台帳から外す
      holding = holding.filter((held) => held.endBeat > event.startBeat + BEAT_EPSILON);

      // 同音の再打鍵はペダル中でも前の音を切る（実ピアノでも同じ弦が打ち直されるため）。
      // ただし**タイの継続音は再打鍵ではない**（round1 P1: 弦は打ち直されず鳴り続けている。
      // 継続音側は発音自体が抑制されるため、ここで前の音を切るとタイ終端で保持が消える）
      const continuations = tieContinuationKeys.get(event.planKey);
      holding.forEach((held) => {
        if (event.keys.includes(held.key) && !continuations?.has(held.key)) {
          release(held, event.startBeat);
        }
      });
      holding = holding.filter((held) => held.endBeat > event.startBeat + BEAT_EPSILON);

      const interval = findIntervalFor(intervals, event.startBeat);
      if (!interval) return;

      event.keys.forEach((key) => {
        if (interval.upBeat <= event.notatedEndBeat + BEAT_EPSILON) return; // 音価の方が長い＝延ばす必要なし
        const note: SoundingNote = {
          planKey: event.planKey,
          key,
          notatedEndBeat: event.notatedEndBeat,
          endBeat: interval.upBeat,
        };
        writeExtend(note);
        holding.push(note);
      });

      // 同時保持数が上限を超えたら、古い音から「この音が鳴り始めた位置」で解放する
      // （音量が振り切れて歪むのを防ぐ。仕様案5）
      while (holding.length > MAX_PEDAL_HELD_NOTES_PER_PART) {
        const oldest = holding.shift();
        if (!oldest) break;
        release(oldest, event.startBeat);
      }
    });

    return plan;
  });
}
