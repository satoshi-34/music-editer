import type { MeasureData, TimeSignature } from '../types/storage';
import { expandMeasuresForPlayback } from '../audio/repeatPlaybackUtils';
import { getMeasureBeats } from './timeSignatureUtils';
import { getEventDurationBeats, getMeasureDurationBeats } from './voiceMeasureUtils';

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
  timeSignature: TimeSignature
): PlaybackTimelineItem[] {
  const expandedMeasures = expandMeasuresForPlayback(measures);
  const msPerBeat = (60 / bpm) * 1000;
  const timeline: PlaybackTimelineItem[] = [];

  let elapsedBeats = 0;

  expandedMeasures.forEach(({ sourceMeasureIndex, measure }) => {
    const visibleEvents = measure.events ?? [];
    let beatPosition = 0;

    visibleEvents.forEach((event, noteIndex) => {
      // 休符は光らせず、実際に音が鳴るイベントだけタイムラインへ積む。
      if (!event.isRest && Array.isArray(event.keys) && event.keys.length > 0) {
        timeline.push({
          atMs: elapsedBeats * msPerBeat + beatPosition * msPerBeat,
          position: {
            measureIndex: sourceMeasureIndex,
            beatPosition,
            noteIndex,
          },
        });
      }

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
