import type { MeasureData } from '../types/storage';
import { getEventDurationBeats, getMeasureVoices } from './voiceMeasureUtils';

/**
 * タイ（同じ高さの2音を弧で結び、1つの音として伸ばす記号）を再生へ反映するための計画。
 *
 * 記譜上は「4分音符 + タイ + 4分音符」でも、耳に聞こえるのは「2分音符1つ」でなければならない。
 * そこで、
 * - タイの開始音には「あと何拍ぶん伸ばすか」（extendBeatsByKey）を持たせ、
 * - タイの継続音は発音そのものを止める（suppressedKeys）
 * という2点セットで、再生エンジンが1音として鳴らせるようにする。
 *
 * 和音の一部だけがタイで結ばれることがあるため、どちらもキー（"e/4" 形式の音高）単位で持つ。
 */
export interface TiePlaybackAdjustment {
  /** キーごとの「タイで追加される拍数」（4分音符 = 1拍） */
  extendBeatsByKey: Record<string, number>;
  /** タイの継続音として、発音（アタック）を止めるキー */
  suppressedKeys: string[];
}

/** キーは buildTiePlaybackEventKey が作る `小節:声部:イベント` の文字列 */
export type TiePlaybackPlan = Map<string, TiePlaybackAdjustment>;

/** 反復記号を展開したあとの1小節分（ScorePage が再生前に作る形と同じ） */
export interface TiePlaybackExpandedMeasure {
  /** 展開前の元の小節番号。TieArc.toMeasureIndex と突き合わせるために使う */
  sourceMeasureIndex: number;
  measure: MeasureData;
}

/** 計画を引くためのキー。展開後の小節位置・声部・声部内イベント位置で1音を特定する */
export function buildTiePlaybackEventKey(
  expandedMeasureIndex: number,
  voiceIndex: number,
  eventIndex: number,
): string {
  return `${expandedMeasureIndex}:${voiceIndex}:${eventIndex}`;
}

/** 1つの符頭（音符の中の1音）を指すID。タイの連鎖をたどるときの節点として使う */
function buildNoteHeadId(
  expandedMeasureIndex: number,
  voiceIndex: number,
  eventIndex: number,
  key: string,
): string {
  return `${buildTiePlaybackEventKey(expandedMeasureIndex, voiceIndex, eventIndex)}:${key}`;
}

type TieEdge = {
  toExpandedMeasureIndex: number;
  voiceIndex: number;
  toEventIndex: number;
  toKey: string;
  /** 継続音の長さ（拍）。開始音へ足し込む値 */
  beats: number;
};

/**
 * 連鎖の暴走を防ぐ上限。
 * 壊れたデータ（相互参照など）でも無限ループにならないよう、常識的な長さで打ち切る。
 */
const MAX_TIE_CHAIN_LENGTH = 128;

/**
 * タイの終点が、展開後のどの小節にあるかを解決する。
 *
 * タイは「同じ小節の後続音」か「すぐ次の小節の音」しか結べない。
 * 一方、反復記号を展開した再生列では同じ小節が何度も現れるため、
 * 元の小節番号（toMeasureIndex）だけでは行き先を一意に決められない。
 * そこで「自分自身の小節」「並び上のすぐ次の小節」の2つだけを候補にする。
 *
 * リピートの飛び先が変わって次の小節が終点でなくなった場合（例: 1番括弧の末尾から
 * 小節をまたぐタイ）は null を返す。この場合はタイを繋げず、記譜どおり2音として鳴らす
 * ＝ 音が消えるより安全側に倒す。
 */
function resolveTargetExpandedIndex(
  expandedMeasures: TiePlaybackExpandedMeasure[],
  fromExpandedIndex: number,
  toMeasureIndex: number,
): number | null {
  if (expandedMeasures[fromExpandedIndex]?.sourceMeasureIndex === toMeasureIndex) {
    return fromExpandedIndex;
  }
  const nextIndex = fromExpandedIndex + 1;
  if (expandedMeasures[nextIndex]?.sourceMeasureIndex === toMeasureIndex) {
    return nextIndex;
  }
  return null;
}

/**
 * 反復展開済みの再生列から、タイを1音として鳴らすための計画を作る。
 *
 * 「展開済み・かつ途中再生で切ったあと」の配列をそのまま渡すこと。
 * 切った結果、開始音が配列の外へ出た継続音は、どの開始音からもたどり着けないので
 * 抑制されず、単独の音として普通に鳴る（途中再生で音が丸ごと消えないための性質）。
 */
export function buildTiePlaybackPlan(
  expandedMeasures: TiePlaybackExpandedMeasure[],
): TiePlaybackPlan {
  // 符頭ID -> 次の符頭（タイ1本ぶん）。連鎖（A—B—C）はこの辺をたどって伸ばす。
  const edges = new Map<string, TieEdge>();
  // 「誰かのタイの終点になっている」符頭。連鎖の先頭を見つけるために使う。
  const targetIds = new Set<string>();

  expandedMeasures.forEach((expandedMeasure, expandedMeasureIndex) => {
    const voices = getMeasureVoices(expandedMeasure.measure);
    voices.forEach((voice, voiceIndex) => {
      voice.events?.forEach((event, eventIndex) => {
        if (event.isRest) return;
        event.arcs?.forEach((arc) => {
          // スラー（なめらかに繋げる指示）は音を1つにまとめない。タイだけが対象。
          if (arc.kind !== 'tie') return;
          if (!event.keys.includes(arc.fromKey)) return;

          const toExpandedMeasureIndex = resolveTargetExpandedIndex(
            expandedMeasures,
            expandedMeasureIndex,
            arc.toMeasureIndex,
          );
          if (toExpandedMeasureIndex === null) return;
          // 同じ小節内では必ず後ろ向き（未来）へしか結べない。
          // 壊れたデータで自分自身や手前を指していたら、循環を避けるため無視する。
          if (toExpandedMeasureIndex === expandedMeasureIndex && arc.toEventIndex <= eventIndex) return;

          // 弧の終点は「同じ声部の events 配列の位置」を指す（voice2-arc-support の案A）。
          const targetVoice = getMeasureVoices(
            expandedMeasures[toExpandedMeasureIndex].measure,
          )[voiceIndex];
          const targetEvent = targetVoice?.events?.[arc.toEventIndex];
          // 保存データの弧は検証されていないため、行き先が消えている（小節削除など）ことがある。
          if (!targetEvent || targetEvent.isRest) return;
          if (!targetEvent.keys.includes(arc.toKey)) return;

          const fromId = buildNoteHeadId(expandedMeasureIndex, voiceIndex, eventIndex, arc.fromKey);
          const toId = buildNoteHeadId(
            toExpandedMeasureIndex,
            voiceIndex,
            arc.toEventIndex,
            arc.toKey,
          );
          // 1つの符頭から2本以上タイが出ることは記譜上ありえない。最初の1本だけ採用する。
          if (edges.has(fromId)) return;
          edges.set(fromId, {
            toExpandedMeasureIndex,
            voiceIndex,
            toEventIndex: arc.toEventIndex,
            toKey: arc.toKey,
            beats: getEventDurationBeats(targetEvent),
          });
          targetIds.add(toId);
        });
      });
    });
  });

  const plan: TiePlaybackPlan = new Map();
  const adjustmentFor = (planKey: string): TiePlaybackAdjustment => {
    const existing = plan.get(planKey);
    if (existing) return existing;
    const created: TiePlaybackAdjustment = { extendBeatsByKey: {}, suppressedKeys: [] };
    plan.set(planKey, created);
    return created;
  };

  edges.forEach((_edge, headId) => {
    // 連鎖の途中（誰かの終点）から数え直すと二重に伸ばしてしまうので、先頭だけを起点にする。
    if (targetIds.has(headId)) return;

    const [headMeasure, headVoice, headEvent, ...headKeyParts] = headId.split(':');
    const headKey = headKeyParts.join(':');
    const headPlanKey = buildTiePlaybackEventKey(
      Number(headMeasure),
      Number(headVoice),
      Number(headEvent),
    );

    let totalExtendBeats = 0;
    let currentId = headId;
    const visited = new Set<string>([headId]);
    for (let step = 0; step < MAX_TIE_CHAIN_LENGTH; step += 1) {
      const edge = edges.get(currentId);
      if (!edge) break;
      const nextId = buildNoteHeadId(
        edge.toExpandedMeasureIndex,
        edge.voiceIndex,
        edge.toEventIndex,
        edge.toKey,
      );
      // 壊れたデータでの循環に備える（同じ符頭を2度通ったら打ち切る）。
      if (visited.has(nextId)) break;
      visited.add(nextId);

      totalExtendBeats += edge.beats;
      const continuation = adjustmentFor(
        buildTiePlaybackEventKey(edge.toExpandedMeasureIndex, edge.voiceIndex, edge.toEventIndex),
      );
      if (!continuation.suppressedKeys.includes(edge.toKey)) {
        continuation.suppressedKeys.push(edge.toKey);
      }
      currentId = nextId;
    }

    if (totalExtendBeats > 0) {
      const head = adjustmentFor(headPlanKey);
      head.extendBeatsByKey[headKey] = (head.extendBeatsByKey[headKey] ?? 0) + totalExtendBeats;
    }
  });

  return plan;
}
