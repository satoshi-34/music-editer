import type { MeasureData, TimeSignature } from '../types/storage';
import { expandMeasuresForPlayback, type ExpandedPlaybackMeasure } from '../audio/repeatPlaybackUtils';
import { getMeasureBeats } from './timeSignatureUtils';
import { getEventDurationBeats, getMeasureDurationBeats, getPrimaryVoiceEvents } from './voiceMeasureUtils';
import { applySwingToTiming, shouldApplySwing } from './swingUtils';

export interface PlaybackTimelinePosition {
  measureIndex: number;
  beatPosition: number;
  noteIndex: number;
}

export interface PlaybackTimelineItem {
  atMs: number;
  position: PlaybackTimelinePosition;
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
  startExpandedIndex: number = 0
): PlaybackTimelineItem[] {
  // 途中再生（#108）: 展開順の先頭 startExpandedIndex 個を丸ごと飛ばす。
  // 実音側（playParts へ渡す小節列）も同じ位置で切るため、atMs は 0 起点のままで一致する
  const expandedMeasures = expandMeasuresForPlayback(measures).slice(Math.max(0, startExpandedIndex));
  const msPerBeat = (60 / bpm) * 1000;
  const timeline: PlaybackTimelineItem[] = [];

  let elapsedBeats = 0;

  expandedMeasures.forEach(({ sourceMeasureIndex, measure }) => {
    // 主声部の読みは正規アクセサ（#244 段5-3）。再生列挙と同じ源を読むことで索引・時刻を一致させる
    const visibleEvents = getPrimaryVoiceEvents(measure);
    let beatPosition = 0;
    // 小節ごとに拍子が変わる譜面では、その小節の拍子でスウィング対象かどうかを判定する。
    const measureTimeSignature = measure.timeSignature ?? timeSignature;
    const swingActiveForMeasure = shouldApplySwing(swingEnabled, measureTimeSignature);

    visibleEvents.forEach((event, noteIndex) => {
      // 休符は光らせず、実際に音が鳴るイベントだけタイムラインへ積む。
      if (!event.isRest && Array.isArray(event.keys) && event.keys.length > 0) {
        // 見た目のハイライトも、実際に鳴る位置（スウィング後）に合わせる。
        // こうしないと、スウィングON時に「音はズレて鳴っているのにハイライトは
        // 均等なまま」という違和感が出てしまう。
        const swingTiming = swingActiveForMeasure
          ? applySwingToTiming(
              { startBeat: beatPosition, durationBeats: getEventDurationBeats(event) },
              event.dur,
              event.dots,
              event.tuplet
            )
          : { startBeat: beatPosition, durationBeats: getEventDurationBeats(event) };

        timeline.push({
          atMs: elapsedBeats * msPerBeat + swingTiming.startBeat * msPerBeat,
          position: {
            measureIndex: sourceMeasureIndex,
            beatPosition: swingTiming.startBeat,
            noteIndex,
          },
        });
      }

      // 次の音符の位置は、スウィングの影響を受けない「本来の拍位置」で進める。
      beatPosition += getEventDurationBeats(event);
    });

    // 実音エンジンは各小節に measureBeats（グローバル拍子の長さ）を下限として渡されるため、
    // 表示の前進も「全声部の実長と拍子長の大きい方」でそろえる（Codex 2巡目）。
    // 未充足の小節を実長だけで進めると、ハイライトが実音より先へ走ってしまう
    elapsedBeats += measureAdvanceBeats(measure, timeSignature);
  });

  return timeline;
}

/**
 * 途中再生（#108）の開始位置: 指定の小節が「展開後の再生順」で最初に現れる位置を返す。
 * リピートのある譜面では同じ小節が複数回鳴るため、「最初の出現から」を仕様とする
 * （2周目のどこか、を選ぶ UI は持たない）。見つからない場合は、その小節以降で
 * 最初に現れる小節（すべて手前なら 0 = 先頭）へ倒す。
 */
/**
 * 1小節ぶんの前進拍数。実音エンジン（playParts）は measureBeats = グローバル拍子の長さを
 * 下限に小節を進めるため、タイムライン・残り時間の両方をこの共通規則でそろえる:
 * max(全声部の実長, 拍子の長さ)。空小節は拍子ぶん、あふれた小節は実長で進む。
 */
function measureAdvanceBeats(measure: MeasureData, timeSignature: TimeSignature): number {
  return Math.max(getMeasureDurationBeats(measure), getMeasureBeats(timeSignature));
}

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
  const msPerBeat = (60 / bpm) * 1000;
  let beats = 0;
  for (let i = 0; i <= lastUsedIndex; i++) {
    beats += measureAdvanceBeats(measures[i], timeSignature);
  }
  return beats * msPerBeat;
}
