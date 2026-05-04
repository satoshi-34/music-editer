import { InstrumentType } from '../audio/SoundSource';
import type { MeasureData, NoteEvent, ScoreMetadata, ScoreType, TimeSignature } from '../types/storage';
import { defaultRestDisplayKey, type ClefType } from '../components/clefUtils';
import type { KeySignature } from '../utils/noteKeyUtils';

export interface DemoScore {
  metadata: ScoreMetadata;
  scoreType: ScoreType;
  keySignature: KeySignature;
  timeSignature: TimeSignature;
  rightHand: MeasureData[];
  leftHand: MeasureData[];
  recommendedInstrument: InstrumentType;
}

export type DemoScoreId = 'fur-elise' | 'brass-test' | 'strings-test' | 'custom-piano';

const CUSTOM_PIANO_SAMPLE_STORAGE_KEY = 'music-score-app-custom-piano-sample';

function note(key: string, dur: NoteEvent['dur']): NoteEvent {
  return {
    dur,
    isRest: false,
    keys: [key]
  };
}

function noteWithDynamics(
  key: string,
  dur: NoteEvent['dur'],
  dynamics: NonNullable<NoteEvent['dynamics']>
): NoteEvent {
  return {
    dur,
    isRest: false,
    keys: [key],
    dynamics,
  };
}

function chord(keys: string[], dur: NoteEvent['dur']): NoteEvent {
  return {
    dur,
    isRest: false,
    keys
  };
}

function rest(dur: NoteEvent['dur'], clef: ClefType = 'treble'): NoteEvent {
  return {
    dur,
    isRest: true,
    // デモ譜面も編集直後の見た目とそろえておくと、
    // サンプルを開いた瞬間の休符位置が実入力時と一致して分かりやすい。
    keys: [defaultRestDisplayKey(clef)]
  };
}

function measure(events: NoteEvent[]): MeasureData {
  return { events };
}

function measureWithMarkers(
  events: NoteEvent[],
  options: Pick<MeasureData, 'repeatStart' | 'repeatEnd' | 'ending'>
): MeasureData {
  return {
    events,
    repeatStart: options.repeatStart,
    repeatEnd: options.repeatEnd,
    ending: options.ending,
  };
}

function emptyMeasures(count: number): MeasureData[] {
  return Array.from({ length: count }, () => ({ events: [] }));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidScoreMetadata(value: unknown): value is ScoreMetadata {
  return isObjectRecord(value) &&
    typeof value.title === 'string' &&
    typeof value.subtitle === 'string' &&
    typeof value.lyricist === 'string' &&
    typeof value.composer === 'string' &&
    typeof value.arranger === 'string';
}

function isValidMeasureDataArray(value: unknown): value is MeasureData[] {
  return Array.isArray(value);
}

function isValidCustomDemoScore(value: unknown): value is DemoScore {
  return isObjectRecord(value) &&
    isValidScoreMetadata(value.metadata) &&
    value.scoreType === 'piano' &&
    Array.isArray(value.timeSignature) &&
    value.timeSignature.length === 2 &&
    typeof value.timeSignature[0] === 'number' &&
    typeof value.timeSignature[1] === 'number' &&
    typeof value.keySignature === 'string' &&
    isValidMeasureDataArray(value.rightHand) &&
    isValidMeasureDataArray(value.leftHand) &&
    typeof value.recommendedInstrument === 'string';
}

export function hasCustomPianoDemoScore(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return !!window.localStorage.getItem(CUSTOM_PIANO_SAMPLE_STORAGE_KEY);
}

export function saveCustomPianoDemoScore(score: DemoScore): boolean {
  if (typeof window === 'undefined' || score.scoreType !== 'piano') {
    return false;
  }

  const payload: DemoScore = {
    ...score,
    scoreType: 'piano',
    recommendedInstrument: score.recommendedInstrument ?? InstrumentType.PIANO,
  };

  try {
    window.localStorage.setItem(CUSTOM_PIANO_SAMPLE_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch (error) {
    console.error('[demoScores] カスタムピアノサンプルの保存に失敗しました:', error);
    return false;
  }
}

export function loadCustomPianoDemoScore(): DemoScore | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(CUSTOM_PIANO_SAMPLE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isValidCustomDemoScore(parsed)) {
      return null;
    }

    return {
      ...parsed,
      scoreType: 'piano',
      recommendedInstrument: parsed.recommendedInstrument || InstrumentType.PIANO,
    };
  } catch (error) {
    console.error('[demoScores] カスタムピアノサンプルの読込に失敗しました:', error);
    return null;
  }
}

/**
 * ユーザー説明用のピアノデモ譜。
 * 厳密な原典版の完全再現ではなく、「このアプリで有名曲を表示・再生できる」ことを
 * 分かりやすく見せるための主題デモとして用意している。
 */
export function createFurEliseDemoScore(): DemoScore {
  const rightHandMeasures: MeasureData[] = [
    // 2枚目の譜例に近い「軽い冒頭」を優先し、
    // 冒頭は単声部ベースで組んで余計な内声を消す。
    measureWithMarkers([
      noteWithDynamics('e/5', '16', [{ value: 'pp' }]),
      note('d#/5', '16'),
      note('e/5', '16'),
      note('d#/5', '16'),
      note('e/5', '16'),
      note('b/4', '16')
    ], { repeatStart: true }),
    measure([
      note('d/5', '16'),
      note('c/5', '16'),
      note('a/4', '16'),
      note('c/5', '16'),
      note('e/5', '16'),
      note('a/4', '16')
    ]),
    measure([
      note('b/4', '8'),
      rest('8', 'treble'),
      note('e/4', '16'),
      note('g#/4', '16')
    ]),
    measure([
      note('a/4', '8'),
      rest('8', 'treble'),
      note('e/4', '16'),
      note('a/4', '16')
    ]),
    measure([
      note('b/4', '8'),
      rest('8', 'treble'),
      note('g#/4', '16'),
      note('b/4', '16')
    ]),
    measure([
      note('c/5', '8'),
      rest('8', 'treble'),
      note('e/5', '16'),
      note('d/5', '16')
    ]),
    measureWithMarkers([
      note('a/4', '8'),
      rest('8', 'treble'),
      rest('8', 'treble')
    ], { repeatEnd: true, ending: 1 }),
    measureWithMarkers([
      note('b/4', '8'),
      rest('8', 'treble'),
      note('c/5', '16'),
      note('d/5', '16')
    ], { ending: 2 }),
    measure([
      note('c/5', '8'),
      rest('8', 'treble'),
      note('e/5', '16'),
      note('g/5', '16')
    ]),
    measure([
      note('a/4', '8'),
      rest('8', 'treble'),
      note('e/5', '16'),
      note('d/5', '16')
    ]),
    measure([
      note('g#/4', '8'),
      rest('8', 'treble'),
      note('e/5', '16'),
      note('g#/5', '16')
    ]),
    measure([
      note('b/4', '8'),
      rest('8', 'treble'),
      note('g#/4', '16'),
      note('b/4', '16')
    ]),
  ];

  const leftHandMeasures: MeasureData[] = [
    // 左手は冒頭2小節を空け、その後に軽い分散和音を置く。
    // これで見本画像の「右手が先に聞こえる」印象へ寄せる。
    measureWithMarkers([], { repeatStart: true }),
    measure([]),
    // 手本の左手は A-C-E の和音型ではなく、
    // A-E-A / E-E-G# のように広めの分散和音で進む。
    // 3/8 小節を正しく満たすため、16分3音の後ろに 16分休符 + 8分休符を置く。
    measure([note('a/2', '16'), note('e/3', '16'), note('a/3', '16'), rest('16', 'bass'), rest('8', 'bass')]),
    measure([note('a/2', '16'), note('e/3', '16'), note('a/3', '16'), rest('16', 'bass'), rest('8', 'bass')]),
    measure([note('e/2', '16'), note('e/3', '16'), note('g#/3', '16'), rest('16', 'bass'), rest('8', 'bass')]),
    measure([note('a/2', '16'), note('e/3', '16'), note('a/3', '16'), rest('16', 'bass'), rest('8', 'bass')]),
    measureWithMarkers([note('a/2', '16'), note('e/3', '16'), note('a/3', '16'), rest('16', 'bass'), rest('8', 'bass')], { repeatEnd: true, ending: 1 }),
    measureWithMarkers([note('e/2', '16'), note('e/3', '16'), note('g#/3', '16'), rest('16', 'bass'), rest('8', 'bass')], { ending: 2 }),
    measure([note('a/2', '16'), note('e/3', '16'), note('a/3', '16'), rest('16', 'bass'), rest('8', 'bass')]),
    measure([note('e/2', '16'), note('e/3', '16'), note('g#/3', '16'), rest('16', 'bass'), rest('8', 'bass')]),
    measure([note('a/2', '16'), note('e/3', '16'), note('a/3', '16'), rest('16', 'bass'), rest('8', 'bass')]),
    measure([note('e/2', '16'), note('e/3', '16'), note('g#/3', '16'), rest('16', 'bass'), rest('8', 'bass')]),
  ];

  const trailingMeasures = emptyMeasures(48 - rightHandMeasures.length);

  return {
    metadata: {
      title: 'Fur Elise',
      subtitle: 'Clavierstuck in A Minor - WoO 59',
      lyricist: '',
      composer: 'Ludwig van Beethoven',
      arranger: ''
    },
    scoreType: 'piano',
    // 「エリーゼのために」冒頭主題に合わせ、調号なし（イ短調系）で置く。
    keySignature: 'C',
    // 有名な冒頭主題として認識しやすいよう、3/8 の小節感を維持する。
    timeSignature: [3, 8],
    rightHand: [...rightHandMeasures, ...trailingMeasures],
    leftHand: [...leftHandMeasures, ...emptyMeasures(48 - leftHandMeasures.length)],
    recommendedInstrument: InstrumentType.PIANO
  };
}

/**
 * 金管のキャラクター確認用サンプル。
 * 長めの音、上行形、跳躍を混ぜて、トランペットやホルンの違いを聴き取りやすくする。
 */
export function createBrassTestDemoScore(): DemoScore {
  const melodyMeasures: MeasureData[] = [
    measure([note('c/4', '4'), note('e/4', '4'), note('g/4', '4'), note('c/5', '4')]),
    measure([note('g/4', '2'), note('e/4', '4'), note('c/4', '4')]),
    measure([note('d/4', '4'), note('f/4', '4'), note('a/4', '4'), note('d/5', '4')]),
    measure([note('a/4', '2'), note('f/4', '4'), note('d/4', '4')]),
    measure([note('g/4', '4'), note('c/5', '4'), note('e/5', '4'), note('g/5', '4')]),
    measure([chord(['c/4', 'e/4', 'g/4'], '2'), rest('2', 'treble')]),
    measure([note('f/4', '2'), note('d/4', '2')]),
    measure([note('c/4', '1')])
  ];

  return {
    metadata: {
      title: '音色チェック',
      subtitle: '金管テストフレーズ',
      lyricist: '',
      composer: 'アプリ内デモ用',
      arranger: 'トランペット / ホルン確認用'
    },
    scoreType: 'single',
    keySignature: 'C',
    timeSignature: [4, 4],
    rightHand: [...melodyMeasures, ...emptyMeasures(24 - melodyMeasures.length)],
    leftHand: [],
    recommendedInstrument: InstrumentType.TRUMPET
  };
}

/**
 * 弦のキャラクター確認用サンプル。
 * 伸ばす音と近接進行を多めにして、弦らしい持続感や質感を聴き取りやすくする。
 */
export function createStringsTestDemoScore(): DemoScore {
  const melodyMeasures: MeasureData[] = [
    measure([note('g/3', '2'), note('a/3', '2')]),
    measure([note('b/3', '2'), note('d/4', '2')]),
    measure([note('e/4', '2'), note('d/4', '2')]),
    measure([note('c/4', '2'), note('b/3', '2')]),
    measure([note('a/3', '1')]),
    measure([note('d/4', '2'), note('f/4', '2')]),
    measure([note('e/4', '2'), note('c/4', '2')]),
    measure([note('g/3', '1')])
  ];

  return {
    metadata: {
      title: '音色チェック',
      subtitle: '弦テストフレーズ',
      lyricist: '',
      composer: 'アプリ内デモ用',
      arranger: 'バイオリン / ヴィオラ / チェロ確認用'
    },
    scoreType: 'single',
    keySignature: 'C',
    timeSignature: [4, 4],
    rightHand: [...melodyMeasures, ...emptyMeasures(24 - melodyMeasures.length)],
    leftHand: [],
    recommendedInstrument: InstrumentType.VIOLIN
  };
}

export function createDemoScore(sampleId: DemoScoreId): DemoScore {
  switch (sampleId) {
    case 'custom-piano': {
      const customDemoScore = loadCustomPianoDemoScore();
      return customDemoScore ?? createFurEliseDemoScore();
    }
    case 'brass-test':
      return createBrassTestDemoScore();
    case 'strings-test':
      return createStringsTestDemoScore();
    case 'fur-elise':
    default:
      return createFurEliseDemoScore();
  }
}
