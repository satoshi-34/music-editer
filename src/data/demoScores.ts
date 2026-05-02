import { InstrumentType } from '../audio/SoundSource';
import type { MeasureData, NoteEvent, ScoreMetadata, ScoreType } from '../types/storage';

export interface DemoScore {
  metadata: ScoreMetadata;
  scoreType: ScoreType;
  rightHand: MeasureData[];
  leftHand: MeasureData[];
  recommendedInstrument: InstrumentType;
}

export type DemoScoreId = 'fur-elise' | 'brass-test' | 'strings-test';

function note(key: string, dur: NoteEvent['dur']): NoteEvent {
  return {
    dur,
    isRest: false,
    keys: [key]
  };
}

function chord(keys: string[], dur: NoteEvent['dur']): NoteEvent {
  return {
    dur,
    isRest: false,
    keys
  };
}

function rest(dur: NoteEvent['dur']): NoteEvent {
  return {
    dur,
    isRest: true,
    keys: []
  };
}

function measure(events: NoteEvent[]): MeasureData {
  return { events };
}

function emptyMeasures(count: number): MeasureData[] {
  return Array.from({ length: count }, () => ({ events: [] }));
}

/**
 * ユーザー説明用のピアノデモ譜。
 * 厳密な原典版の完全再現ではなく、「このアプリで有名曲を表示・再生できる」ことを
 * 分かりやすく見せるための主題デモとして用意している。
 */
export function createFurEliseDemoScore(): DemoScore {
  const rightHandMeasures: MeasureData[] = [
    measure([
      note('e/5', '8'),
      note('d#/5', '8'),
      note('e/5', '8'),
      note('d#/5', '8'),
      note('e/5', '8'),
      note('b/4', '8')
    ]),
    measure([
      note('d/5', '8'),
      note('c/5', '8'),
      note('a/4', '4'),
      note('c/4', '8'),
      note('e/4', '8'),
      note('a/4', '4')
    ]),
    measure([
      note('b/4', '8'),
      note('e/4', '8'),
      note('g#/4', '8'),
      note('b/4', '8'),
      note('c/5', '8'),
      note('e/4', '8')
    ]),
    measure([
      note('e/5', '8'),
      note('d#/5', '8'),
      note('e/5', '8'),
      note('d#/5', '8'),
      note('e/5', '8'),
      note('b/4', '8')
    ]),
    measure([
      note('d/5', '8'),
      note('c/5', '8'),
      note('a/4', '4'),
      note('c/4', '8'),
      note('e/4', '8'),
      note('a/4', '4')
    ]),
    measure([
      note('b/4', '8'),
      note('e/4', '8'),
      note('c/5', '8'),
      note('b/4', '8'),
      note('a/4', '4'),
      rest('4')
    ]),
    measure([
      note('e/5', '8'),
      note('d#/5', '8'),
      note('e/5', '8'),
      note('d#/5', '8'),
      note('e/5', '8'),
      note('b/4', '8')
    ]),
    measure([
      note('d/5', '8'),
      note('c/5', '8'),
      note('a/4', '4'),
      note('c/4', '8'),
      note('e/4', '8'),
      note('a/4', '4')
    ]),
    measure([
      note('b/4', '8'),
      note('e/4', '8'),
      note('g#/4', '8'),
      note('b/4', '8'),
      note('c/5', '8'),
      note('e/4', '8')
    ]),
    measure([
      note('e/5', '8'),
      note('d#/5', '8'),
      note('e/5', '8'),
      note('b/4', '8'),
      note('d/5', '8'),
      note('c/5', '8')
    ]),
    measure([
      note('a/4', '4'),
      note('c/4', '8'),
      note('e/4', '8'),
      note('a/4', '4'),
      note('b/4', '8'),
      note('e/4', '8')
    ]),
    measure([
      note('g/4', '8'),
      note('f/4', '8'),
      note('e/4', '8'),
      note('d/4', '8'),
      note('c/4', '8'),
      note('b/3', '8')
    ]),
    measure([
      note('c/4', '8'),
      note('e/4', '8'),
      note('a/4', '8'),
      note('b/4', '8'),
      note('e/4', '8'),
      note('g#/4', '8')
    ]),
    measure([
      note('b/4', '8'),
      note('c/5', '8'),
      note('e/5', '8'),
      note('g/5', '8'),
      note('f/5', '8'),
      note('e/5', '8')
    ]),
    measure([
      note('d/5', '8'),
      note('f/5', '8'),
      note('e/5', '8'),
      note('d/5', '8'),
      note('c/5', '8'),
      note('e/5', '8')
    ]),
    measure([
      note('d/5', '8'),
      note('c/5', '8'),
      note('b/4', '8'),
      note('a/4', '8'),
      chord(['a/4', 'c/5', 'e/5'], '4'),
      rest('4')
    ])
  ];

  const leftHandMeasures: MeasureData[] = [
    measure([note('a/2', '4'), note('e/3', '4'), note('a/3', '4')]),
    measure([note('a/2', '4'), note('e/3', '4'), note('a/3', '4')]),
    measure([note('e/2', '4'), note('b/2', '4'), note('e/3', '4')]),
    measure([note('a/2', '4'), note('e/3', '4'), note('a/3', '4')]),
    measure([note('a/2', '4'), note('e/3', '4'), note('a/3', '4')]),
    measure([note('e/2', '4'), note('b/2', '4'), note('e/3', '4')]),
    measure([note('a/2', '4'), note('e/3', '4'), note('a/3', '4')]),
    measure([note('a/2', '4'), note('e/3', '4'), note('a/3', '4')]),
    measure([note('e/2', '4'), note('b/2', '4'), note('e/3', '4')]),
    measure([note('a/2', '4'), note('e/3', '4'), note('a/3', '4')]),
    measure([note('a/2', '4'), note('e/3', '4'), note('a/3', '4')]),
    measure([note('g/2', '4'), note('d/3', '4'), note('g/3', '4')]),
    measure([note('c/3', '4'), note('g/3', '4'), note('c/4', '4')]),
    measure([note('g/2', '4'), note('d/3', '4'), note('g/3', '4')]),
    measure([note('f/2', '4'), note('c/3', '4'), note('f/3', '4')]),
    measure([chord(['a/2', 'e/3'], '2'), note('a/2', '4')])
  ];

  const trailingMeasures = emptyMeasures(48 - rightHandMeasures.length);

  return {
    metadata: {
      title: 'エリーゼのために',
      subtitle: 'ユーザー説明用サンプル（主題デモ）',
      lyricist: '',
      composer: 'L. v. ベートーヴェン',
      arranger: 'アプリ内デモ用'
    },
    scoreType: 'piano',
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
    measure([chord(['c/4', 'e/4', 'g/4'], '2'), rest('2')]),
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
    rightHand: [...melodyMeasures, ...emptyMeasures(24 - melodyMeasures.length)],
    leftHand: [],
    recommendedInstrument: InstrumentType.VIOLIN
  };
}

export function createDemoScore(sampleId: DemoScoreId): DemoScore {
  switch (sampleId) {
    case 'brass-test':
      return createBrassTestDemoScore();
    case 'strings-test':
      return createStringsTestDemoScore();
    case 'fur-elise':
    default:
      return createFurEliseDemoScore();
  }
}
