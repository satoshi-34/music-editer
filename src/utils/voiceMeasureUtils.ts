import type { MeasureData, NoteEvent, VoiceData } from '../types/storage';

export type PlaybackMeasureEventWithStart = NoteEvent & {
  /**
   * 小節頭から何拍目で鳴り始めるか。
   * 単声部では省略できるが、複数声部では同時発音位置をそろえるために使う。
   */
  startBeat?: number;
};

const DURATION_TO_BEATS: Record<NoteEvent['dur'], number> = {
  '1': 4,
  '2': 2,
  '4': 1,
  '8': 0.5,
  '16': 0.25,
  '32': 0.125,
  '64': 0.0625,
};

function cloneNoteEvent(event: NoteEvent): NoteEvent {
  return {
    ...event,
    keys: [...event.keys],
    arcs: event.arcs ? [...event.arcs] : undefined,
    dynamics: event.dynamics ? [...event.dynamics] : undefined,
  };
}

export function cloneVoiceData(voice: VoiceData): VoiceData {
  return {
    ...voice,
    events: voice.events.map(cloneNoteEvent),
  };
}

/**
 * 小節データを複製する。
 * multi-voice 対応後は voices も落とさずコピーしないと、
 * 編集のたびに 2 声目だけ消える事故が起きやすいためここでまとめて扱う。
 */
export function cloneMeasureData(measure?: MeasureData): MeasureData {
  return {
    ...(measure ?? {}),
    events: (measure?.events ?? []).map(cloneNoteEvent),
    voices: measure?.voices?.map(cloneVoiceData),
  };
}

export function createEmptyMeasure(): MeasureData {
  return { events: [] };
}

/**
 * 既存実装では measure.events が編集の正本なので、
 * voices[0] がある小節でも primary voice は measure.events を優先して扱う。
 */
export function getMeasureVoices(measure?: MeasureData): VoiceData[] {
  if (!measure) {
    return [{ id: 'voice-1', events: [] }];
  }

  if (!measure.voices || measure.voices.length === 0) {
    return [{ id: 'voice-1', events: measure.events ?? [] }];
  }

  return measure.voices.map((voice, index) => (
    index === 0
      ? { ...voice, events: measure.events ?? voice.events }
      : voice
  ));
}

/**
 * 保存前に primary voice の events を measure.events とそろえる。
 * こうしておくと、古い編集ロジックが events だけを書き換えても
 * 保存データの voices[0] が古いまま残る事故を防げる。
 */
export function syncPrimaryVoiceFromEvents(measure: MeasureData): MeasureData {
  if (!measure.voices || measure.voices.length === 0) {
    return measure;
  }

  return {
    ...measure,
    voices: measure.voices.map((voice, index) => (
      index === 0
        ? { ...voice, events: measure.events.map(cloneNoteEvent) }
        : cloneVoiceData(voice)
    )),
  };
}

export function syncMeasuresPrimaryVoiceFromEvents(measures: MeasureData[]): MeasureData[] {
  return measures.map((measure) => syncPrimaryVoiceFromEvents(cloneMeasureData(measure)));
}

/**
 * 単一イベントの長さを「4分音符=1拍」の基準拍へ変換する。
 * 再生位置の見える化でも同じ計算を使うため、共通関数として公開する。
 */
export function getEventDurationBeats(event: NoteEvent): number {
  return DURATION_TO_BEATS[event.dur] ?? 1;
}

export function getMeasureDurationBeats(measure: MeasureData): number {
  const voices = getMeasureVoices(measure);
  if (voices.length <= 1) {
    return (measure.events ?? []).reduce((sum, event) => sum + getEventDurationBeats(event), 0);
  }

  return voices.reduce((maxBeats, voice) => {
    const voiceBeats = voice.events.reduce((sum, event) => sum + getEventDurationBeats(event), 0);
    return Math.max(maxBeats, voiceBeats);
  }, 0);
}

/**
 * 複数声部を「小節内の開始拍つきイベント列」へ変換する。
 * 再生エンジン側はこの startBeat を使って、同じ小節の中で
 * 上声と下声を同時に鳴らせるようになる。
 */
export function flattenMeasureForPlayback(measure: MeasureData): PlaybackMeasureEventWithStart[] {
  const voices = getMeasureVoices(measure);
  if (voices.length <= 1) {
    return (measure.events ?? []).map((event) => ({ ...cloneNoteEvent(event) }));
  }

  const flattened: Array<PlaybackMeasureEventWithStart & { voiceIndex: number }> = [];
  voices.forEach((voice, voiceIndex) => {
    let currentBeat = 0;
    voice.events.forEach((event) => {
      flattened.push({
        ...cloneNoteEvent(event),
        startBeat: currentBeat,
        voiceIndex,
      });
      currentBeat += getEventDurationBeats(event);
    });
  });

  flattened.sort((left, right) => {
    const beatDiff = (left.startBeat ?? 0) - (right.startBeat ?? 0);
    if (Math.abs(beatDiff) > 0.0001) {
      return beatDiff;
    }
    return left.voiceIndex - right.voiceIndex;
  });

  return flattened.map(({ voiceIndex: _voiceIndex, ...event }) => event);
}
