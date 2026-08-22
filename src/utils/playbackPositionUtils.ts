import type { MeasureData, TimeSignature } from '../types/storage';
import { expandMeasuresForPlayback } from '../audio/repeatPlaybackUtils';
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
  swingEnabled: boolean = false
): PlaybackTimelineItem[] {
  const expandedMeasures = expandMeasuresForPlayback(measures);
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

    // 空小節は拍子の長さぶん進める。
    // 中身がある小節は、複数声部も考慮した実際の小節長を使う。
    elapsedBeats += visibleEvents.length === 0
      ? getMeasureBeats(timeSignature)
      : getMeasureDurationBeats(measure);
  });

  return timeline;
}
