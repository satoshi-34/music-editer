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
    articulations: event.articulations ? [...event.articulations] : undefined,
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
 * 指定した声部（voiceIndex）の events 配列を取得する。
 * voiceIndex 0 は primary voice なので measure.events を正本として返す。
 * voiceIndex 1 以降は measure.voices[voiceIndex] が無ければ空配列を返す
 * （まだ何も入力されていない状態を表す）。
 */
export function getVoiceEvents(measure: MeasureData, voiceIndex: number): NoteEvent[] {
  if (voiceIndex <= 0) {
    return measure.events ?? [];
  }
  return measure.voices?.[voiceIndex]?.events ?? [];
}

/**
 * 声部を編集するための入力UI（声部切り替えトグル）から呼ばれる更新ヘルパー。
 * voiceIndex 0 のときは既存互換のため measure.events を直接書き換える。
 * voiceIndex 1 以降は measure.voices を必要な数だけ作りながら、
 * 対象の声部だけ events を更新した新しい MeasureData を返す。
 *
 * 2声部目（voices[1]）は「下声」として使われることが多いため、
 * 新規作成時はデフォルトで符幹を下向き（stemDirection: 'down'）にする。
 * こうしておくと、ユーザーが声部を切り替えて入力しただけで
 * 上声・下声が符幹の向きで見分けられるようになる。
 */
export function withVoiceEventsUpdated(
  measure: MeasureData,
  voiceIndex: number,
  updater: (events: NoteEvent[]) => NoteEvent[],
): MeasureData {
  if (voiceIndex <= 0) {
    return { ...measure, events: updater(measure.events ?? []) };
  }

  const existingVoices = measure.voices?.map(cloneVoiceData) ?? [
    { id: 'voice-1', events: (measure.events ?? []).map(cloneNoteEvent) },
  ];
  while (existingVoices.length <= voiceIndex) {
    existingVoices.push({
      id: `voice-${existingVoices.length + 1}`,
      events: [],
      stemDirection: existingVoices.length === 1 ? 'down' : undefined,
    });
  }
  existingVoices[voiceIndex] = {
    ...existingVoices[voiceIndex],
    events: updater(existingVoices[voiceIndex].events),
  };
  return { ...measure, voices: existingVoices };
}

/**
 * 付点による拍数の倍率。
 * 付点1個 = 1.5倍（元の長さ + その半分）、複付点(2個) = 1.75倍（元の長さ + 半分 + 4分の1）。
 */
export function dotsMultiplier(dots?: 1 | 2): number {
  if (dots === 1) return 1.5;
  if (dots === 2) return 1.75;
  return 1;
}

/**
 * 音価（と付点）から「4分音符=1拍」の基準拍数を計算する共通ヘルパー。
 * 複数ファイルに同じ倍率計算が重複しないよう、ここに集約する。
 */
export function getDurationBeats(dur: NoteEvent['dur'], dots?: 1 | 2): number {
  const base = DURATION_TO_BEATS[dur] ?? 1;
  return base * dotsMultiplier(dots);
}

/**
 * 連符による拍数の倍率。
 * 例: 3連符（3個の音符を2個ぶんの時間に詰める）は notesOccupied/numNotes = 2/3 倍。
 * tuplet が無い通常の音符は 1 倍のまま。
 */
export function tupletBeatsMultiplier(tuplet?: { numNotes: number; notesOccupied: number }): number {
  if (!tuplet || !tuplet.numNotes) return 1;
  return tuplet.notesOccupied / tuplet.numNotes;
}

/**
 * 単一イベントの長さを「4分音符=1拍」の基準拍へ変換する。
 * 再生位置の見える化でも同じ計算を使うため、共通関数として公開する。
 * 連符（tuplet）が付いている場合は、実際に占める時間（notesOccupied/numNotes 倍）まで反映する。
 */
export function getEventDurationBeats(event: NoteEvent): number {
  return getDurationBeats(event.dur, event.dots) * tupletBeatsMultiplier(event.tuplet);
}

/**
 * 2声部が共存する小節での符幹の向きを決める純ロジック。
 *
 * 標準的な浄書ルール（バッハのアルマンドのような2声部書法）では、
 * 声部1（上声）は常に符幹上向き、声部2（下声）は常に符幹下向きになる。
 * ここを VexFlow の自動判定に任せると、音高によって符幹の向きがばらつき、
 * どちらの声部の音符か読み取りづらくなってしまう。
 *
 * - 声部が1つしか無い小節（voices.length <= 1）では、
 *   従来通りの自動判定に任せたいので、ここでは何も上書きしない
 *   （stemDirection を明示しないことで既存の見た目を壊さない = リグレッション防止）。
 * - 声部が2つ以上ある小節でだけ、voices[0] を 'up'、voices[1] 以降を 'down' に強制する。
 *   既存データに個別の stemDirection が保存されていても、2声部共存時はここで上書きする。
 */
export function resolveVoiceStemDirections(voices: VoiceData[]): VoiceData[] {
  if (voices.length <= 1) {
    return voices;
  }
  return voices.map((voice, index) => ({
    ...voice,
    stemDirection: index === 0 ? 'up' : 'down',
  }));
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
