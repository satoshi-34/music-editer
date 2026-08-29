import { InstrumentType } from '../audio/SoundSource';
import type {
  InstrumentBracketGroup,
  InstrumentFamily,
  InstrumentPartDefinition,
  InstrumentationPresetId,
  ScoreInstrumentation,
  ScoreType,
} from '../types/storage';

type PartInput = Omit<InstrumentPartDefinition, 'order'>;

function part(input: PartInput): PartInput {
  return input;
}

function buildInstrumentation(
  presetId: InstrumentationPresetId,
  name: string,
  parts: PartInput[]
): ScoreInstrumentation {
  return {
    presetId,
    name,
    parts: parts.map((item, index) => ({ ...item, order: index })),
  };
}

function simplePart(
  id: string,
  name: string,
  abbreviation: string,
  family: InstrumentFamily,
  bracketGroup: InstrumentBracketGroup,
  clef: InstrumentPartDefinition['clef'],
  playbackInstrument: InstrumentType,
  transposition: InstrumentPartDefinition['transposition'] = 'C',
  subBracketGroup?: string
): PartInput {
  return part({
    id,
    name,
    abbreviation,
    family,
    clef,
    staffCount: 1,
    transposition,
    bracketGroup,
    subBracketGroup,
    playbackInstrument,
  });
}

const PIANO_PARTS: PartInput[] = [
  part({
    id: 'piano',
    name: 'Piano',
    abbreviation: 'Pno.',
    family: 'keyboard',
    clef: 'treble',
    staffCount: 2,
    transposition: 'C',
    bracketGroup: 'keyboard',
    playbackInstrument: InstrumentType.PIANO,
  }),
];

const STRING_QUARTET_PARTS: PartInput[] = [
  // Vln I と Vln II は伝統的に細い括弧でまとめて「ヴァイオリン群」と見せるため、
  // 同じ subBracketGroup 'violins' を割り当てる。
  // 略称は QuartetStaff の既定名（QUARTET_PART_CONFIGS: Vn. I / Va.）に合わせる。
  // #448 で総譜のラベル正本がこちらへ移ったため、ここが違うと未編集の四重奏でも
  // 2段目以降の略称が従来（Vn. I / Va.）から変わってしまう（Codex round2 P2）
  simplePart('violin-1', 'Violin I', 'Vn. I', 'strings', 'strings', 'treble', InstrumentType.VIOLIN, 'C', 'violins'),
  simplePart('violin-2', 'Violin II', 'Vn. II', 'strings', 'strings', 'treble', InstrumentType.VIOLIN, 'C', 'violins'),
  simplePart('viola', 'Viola', 'Va.', 'strings', 'strings', 'alto', InstrumentType.VIOLA),
  simplePart('cello', 'Violoncello', 'Vc.', 'strings', 'strings', 'bass', InstrumentType.CELLO),
];

const STRING_ORCHESTRA_PARTS: PartInput[] = [
  // 低弦（Vc・Cb）は同じ五線上にまたいで書く流派もあるが、ここではセクションだけ分け、
  // 視覚的にひとまとめに見せたいので低弦のサブグループを追加する。
  // 弦楽四重奏では Violoncello だけなので括弧を出さず、弦楽合奏以上に展開するときだけ
  // Violoncello と Contrabass を同じ 'low-strings' にして細い括弧でまとめる。
  // 弦セクションの略称はオーケストラ系の従来表記（Vln. / Vla.）を保つ。
  // 四重奏プリセットの略称互換修正（Vn. / Va.）を波及させない（Codex round3 P2）
  ...STRING_QUARTET_PARTS.map(part => {
    const orchestraAbbreviation =
      part.id === 'violin-1' ? 'Vln. I'
      : part.id === 'violin-2' ? 'Vln. II'
      : part.id === 'viola' ? 'Vla.'
      : part.abbreviation;
    const withAbbr = { ...part, abbreviation: orchestraAbbreviation };
    return part.id === 'cello' ? { ...withAbbr, subBracketGroup: 'low-strings' } : withAbbr;
  }),
  simplePart('contrabass', 'Contrabass', 'Cb.', 'strings', 'strings', 'bass', InstrumentType.CONTRABASS, 'octave-down', 'low-strings'),
];

const CLASSICAL_WOODWINDS: PartInput[] = [
  simplePart('flute-1-2', 'Flute 1-2', 'Fl.', 'woodwind', 'woodwinds', 'treble', InstrumentType.FLUTE),
  simplePart('oboe-1-2', 'Oboe 1-2', 'Ob.', 'woodwind', 'woodwinds', 'treble', InstrumentType.OBOE),
  simplePart('clarinet-1-2', 'Clarinet 1-2 in Bb', 'Cl.', 'woodwind', 'woodwinds', 'treble', InstrumentType.CLARINET, 'Bb'),
  simplePart('bassoon-1-2', 'Bassoon 1-2', 'Bsn.', 'woodwind', 'woodwinds', 'bass', InstrumentType.BASSOON),
];

const CLASSICAL_BRASS: PartInput[] = [
  simplePart('horn-1-2', 'Horn 1-2 in F', 'Hn.', 'brass', 'brass', 'treble', InstrumentType.HORN, 'F'),
  simplePart('trumpet-1-2', 'Trumpet 1-2 in Bb', 'Tpt.', 'brass', 'brass', 'treble', InstrumentType.TRUMPET, 'Bb'),
  simplePart('timpani', 'Timpani', 'Timp.', 'percussion', 'percussion', 'bass', InstrumentType.TIMPANI),
];

const ROMANTIC_ADDITIONS: PartInput[] = [
  simplePart('piccolo', 'Piccolo', 'Picc.', 'woodwind', 'woodwinds', 'treble', InstrumentType.PICCOLO),
  simplePart('english-horn', 'English Horn', 'E.H.', 'woodwind', 'woodwinds', 'treble', InstrumentType.ENGLISH_HORN, 'F'),
  simplePart('trombone-1-2', 'Trombone 1-2', 'Tbn.', 'brass', 'brass', 'bass', InstrumentType.TROMBONE),
  simplePart('tuba', 'Tuba', 'Tba.', 'brass', 'brass', 'bass', InstrumentType.TUBA),
  simplePart('percussion', 'Percussion', 'Perc.', 'percussion', 'percussion', 'treble', InstrumentType.PERCUSSION),
];

export const INSTRUMENTATION_PRESETS: ScoreInstrumentation[] = [
  buildInstrumentation('single', '単旋律', [
    simplePart('melody', 'Melody', 'Mel.', 'other', 'solo', 'treble', InstrumentType.PIANO),
  ]),
  buildInstrumentation('piano', 'ピアノ', PIANO_PARTS),
  buildInstrumentation('string-quartet', '弦楽四重奏', STRING_QUARTET_PARTS),
  buildInstrumentation('string-orchestra', '弦楽合奏', STRING_ORCHESTRA_PARTS),
  buildInstrumentation('chamber-orchestra', '室内オーケストラ', [
    simplePart('flute', 'Flute', 'Fl.', 'woodwind', 'woodwinds', 'treble', InstrumentType.FLUTE),
    simplePart('oboe', 'Oboe', 'Ob.', 'woodwind', 'woodwinds', 'treble', InstrumentType.OBOE),
    simplePart('horn', 'Horn in F', 'Hn.', 'brass', 'brass', 'treble', InstrumentType.HORN, 'F'),
    ...STRING_ORCHESTRA_PARTS,
  ]),
  buildInstrumentation('classical-orchestra', '二管編成オーケストラ', [
    ...CLASSICAL_WOODWINDS,
    ...CLASSICAL_BRASS,
    ...STRING_ORCHESTRA_PARTS,
  ]),
  buildInstrumentation('romantic-orchestra', '大編成オーケストラ', [
    ...ROMANTIC_ADDITIONS.slice(0, 2),
    ...CLASSICAL_WOODWINDS,
    ...CLASSICAL_BRASS,
    ...ROMANTIC_ADDITIONS.slice(2),
    ...STRING_ORCHESTRA_PARTS,
  ]),
  buildInstrumentation('wind-band', '吹奏楽', [
    simplePart('flute-piccolo', 'Flute / Piccolo', 'Fl.', 'woodwind', 'woodwinds', 'treble', InstrumentType.FLUTE),
    simplePart('clarinet', 'Clarinet in Bb', 'Cl.', 'woodwind', 'woodwinds', 'treble', InstrumentType.CLARINET, 'Bb'),
    simplePart('alto-sax', 'Alto Saxophone in Eb', 'A. Sax.', 'woodwind', 'woodwinds', 'treble', InstrumentType.ALTO_SAX, 'Eb'),
    simplePart('tenor-sax', 'Tenor Saxophone in Bb', 'T. Sax.', 'woodwind', 'woodwinds', 'treble', InstrumentType.TENOR_SAX, 'Bb'),
    simplePart('trumpet', 'Trumpet in Bb', 'Tpt.', 'brass', 'brass', 'treble', InstrumentType.TRUMPET, 'Bb'),
    simplePart('horn', 'Horn in F', 'Hn.', 'brass', 'brass', 'treble', InstrumentType.HORN, 'F'),
    simplePart('trombone', 'Trombone', 'Tbn.', 'brass', 'brass', 'bass', InstrumentType.TROMBONE),
    simplePart('euphonium', 'Euphonium', 'Euph.', 'brass', 'brass', 'bass', InstrumentType.EUPHONIUM),
    simplePart('tuba', 'Tuba', 'Tba.', 'brass', 'brass', 'bass', InstrumentType.TUBA),
    simplePart('percussion', 'Percussion', 'Perc.', 'percussion', 'percussion', 'treble', InstrumentType.PERCUSSION),
  ]),
  // 歌もの伴奏編成（Issue #57・スタックPR 2/2）。歌パートには再生用の専用音色が
  // 無いため、単旋律プリセット（melody）と同じく PIANO を playbackInstrument に使う。
  buildInstrumentation('vocal-piano', '歌＋ピアノ', [
    simplePart('voice', 'Voice', 'Vo.', 'vocal', 'voices', 'treble', InstrumentType.PIANO),
    ...PIANO_PARTS,
  ]),
  buildInstrumentation('recorder-vocal', 'リコーダー＋歌', [
    // 2パートとも独立した旋律なので、家族が異なる（木管/声楽）ことも踏まえ
    // bracketGroup は 'solo' にして誤ってグループ括弧でまとめない。
    simplePart('recorder', 'Recorder', 'Rec.', 'woodwind', 'solo', 'treble', InstrumentType.FLUTE),
    simplePart('voice', 'Voice', 'Vo.', 'vocal', 'solo', 'treble', InstrumentType.PIANO),
  ]),
];

export function cloneInstrumentation(instrumentation: ScoreInstrumentation): ScoreInstrumentation {
  return {
    ...instrumentation,
    parts: instrumentation.parts.map(part => ({ ...part })),
  };
}

export function getInstrumentationPreset(presetId: InstrumentationPresetId): ScoreInstrumentation {
  return cloneInstrumentation(
    INSTRUMENTATION_PRESETS.find(preset => preset.presetId === presetId) ?? INSTRUMENTATION_PRESETS[0]
  );
}

export function getDefaultInstrumentationForScoreType(scoreType: ScoreType): ScoreInstrumentation {
  if (scoreType === 'piano') {
    return getInstrumentationPreset('piano');
  }
  if (scoreType === 'quartet') {
    return getInstrumentationPreset('string-quartet');
  }
  if (scoreType === 'ensemble') {
    return getInstrumentationPreset('chamber-orchestra');
  }
  return getInstrumentationPreset('single');
}

export function getScoreTypeForInstrumentation(presetId: InstrumentationPresetId): ScoreType {
  if (presetId === 'piano') {
    return 'piano';
  }
  if (presetId === 'string-quartet') {
    return 'quartet';
  }
  if (presetId !== 'single') {
    return 'ensemble';
  }
  return 'single';
}


/**
 * 編成のパート名・略称が、その譜種の既定から書き換えられているか（Issue #448）。
 *
 * 自動保存は「内容（音符）が空の譜面は保存しない」ガードを持つが、
 * 新規の四重奏で先に楽器名だけを設定した状態はこのガードに落ちて名前が失われる。
 * 「名前が既定から変わっている」ことを内容の一部とみなすための判定。
 * パート数が違う場合（編成を組み替えた場合）もカスタムとみなす。
 */
export function hasCustomInstrumentationLabels(
  instrumentation: ScoreInstrumentation,
  scoreType: ScoreType,
): boolean {
  const defaults = getDefaultInstrumentationForScoreType(scoreType).parts;
  if (instrumentation.parts.length !== defaults.length) return true;
  return instrumentation.parts.some((part) => {
    const def = defaults.find((d) => d.id === part.id);
    if (!def) return true;
    return part.name !== def.name || part.abbreviation !== def.abbreviation;
  });
}

/**
 * 旧既定の略称（Vln. I / Vln. II / Vla.）を新既定（Vn. I / Vn. II / Va.）へ移行する（#448 round3）。
 *
 * 四重奏の略称正本が QuartetStaff の固定値から編成定義へ移った際、
 * プリセットの略称を従来表示（Vn. I / Va.）に合わせた。旧プリセット値で
 * 保存された作品を開くと略称だけ旧表記（Vln. I / Vla.）へ戻ってしまうため、
 * 復元時に「旧既定のまま＝未編集」の略称だけ差し替える。
 * ユーザーが書き換えた略称（旧既定と一致しない値）はそのまま残す。
 *
 * savedVersion は保存データの version（例: '3.5.0'）。3.6.0 以降のデータは
 * 新既定で保存されているため移行しない（round4: 現行版でユーザーが意図して
 * Vln. I 等へ書き換えた値を、再読込のたびに戻してしまわないため）。
 */
export function migrateLegacyQuartetAbbreviations(
  instrumentation: ScoreInstrumentation,
  savedVersion: string | undefined,
): ScoreInstrumentation {
  if (!isVersionBefore(savedVersion, [3, 6, 0])) return instrumentation;
  if (instrumentation.presetId !== 'string-quartet') return instrumentation;
  const LEGACY_DEFAULT_ABBREVIATIONS: Record<string, [legacy: string, current: string]> = {
    'violin-1': ['Vln. I', 'Vn. I'],
    'violin-2': ['Vln. II', 'Vn. II'],
    'viola': ['Vla.', 'Va.'],
  };
  let changed = false;
  const parts = instrumentation.parts.map((part) => {
    const entry = LEGACY_DEFAULT_ABBREVIATIONS[part.id];
    if (!entry || part.abbreviation !== entry[0]) return part;
    changed = true;
    return { ...part, abbreviation: entry[1] };
  });
  return changed ? { ...instrumentation, parts } : instrumentation;
}

/** 保存データのバージョン文字列が指定バージョンより古いか（数値の辞書順比較） */
function isVersionBefore(version: string | undefined, target: [number, number, number]): boolean {
  if (!version) return true; // バージョン不明の旧データは移行対象とみなす
  const nums = version.split('.').map(n => Number.parseInt(n, 10));
  if (nums.length < 3 || nums.some(n => !Number.isFinite(n))) return true;
  for (let i = 0; i < 3; i++) {
    if (nums[i] !== target[i]) return nums[i] < target[i];
  }
  return false;
}
