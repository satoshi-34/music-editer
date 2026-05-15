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
  simplePart('violin-1', 'Violin I', 'Vln. I', 'strings', 'strings', 'treble', InstrumentType.VIOLIN, 'C', 'violins'),
  simplePart('violin-2', 'Violin II', 'Vln. II', 'strings', 'strings', 'treble', InstrumentType.VIOLIN, 'C', 'violins'),
  simplePart('viola', 'Viola', 'Vla.', 'strings', 'strings', 'alto', InstrumentType.VIOLA),
  simplePart('cello', 'Cello', 'Vc.', 'strings', 'strings', 'bass', InstrumentType.CELLO),
];

const STRING_ORCHESTRA_PARTS: PartInput[] = [
  // 低弦（Vc・Cb）は同じ五線上にまたいで書く流派もあるが、ここではセクションだけ分け、
  // 視覚的にひとまとめに見せたいので低弦のサブグループを追加する。
  // 弦楽四重奏では Cello だけなので括弧を出さず、弦楽合奏以上に展開するときだけ
  // Cello と Contrabass を同じ 'low-strings' にして細い括弧でまとめる。
  ...STRING_QUARTET_PARTS.map(part => part.id === 'cello'
    ? { ...part, subBracketGroup: 'low-strings' }
    : part
  ),
  simplePart('contrabass', 'Contrabass', 'Cb.', 'strings', 'strings', 'bass', InstrumentType.CONTRABASS, 'octave-down', 'low-strings'),
];

const CLASSICAL_WOODWINDS: PartInput[] = [
  simplePart('flute-1-2', 'Flute 1-2', 'Fl.', 'woodwind', 'woodwinds', 'treble', InstrumentType.FLUTE),
  simplePart('oboe-1-2', 'Oboe 1-2', 'Ob.', 'woodwind', 'woodwinds', 'treble', InstrumentType.OBOE),
  simplePart('clarinet-1-2', 'Clarinet 1-2 in Bb', 'Cl.', 'woodwind', 'woodwinds', 'treble', InstrumentType.WOODWIND, 'Bb'),
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
    simplePart('clarinet', 'Clarinet in Bb', 'Cl.', 'woodwind', 'woodwinds', 'treble', InstrumentType.WOODWIND, 'Bb'),
    simplePart('alto-sax', 'Alto Saxophone in Eb', 'A. Sax.', 'woodwind', 'woodwinds', 'treble', InstrumentType.ALTO_SAX, 'Eb'),
    simplePart('tenor-sax', 'Tenor Saxophone in Bb', 'T. Sax.', 'woodwind', 'woodwinds', 'treble', InstrumentType.TENOR_SAX, 'Bb'),
    simplePart('trumpet', 'Trumpet in Bb', 'Tpt.', 'brass', 'brass', 'treble', InstrumentType.TRUMPET, 'Bb'),
    simplePart('horn', 'Horn in F', 'Hn.', 'brass', 'brass', 'treble', InstrumentType.HORN, 'F'),
    simplePart('trombone', 'Trombone', 'Tbn.', 'brass', 'brass', 'bass', InstrumentType.TROMBONE),
    simplePart('euphonium', 'Euphonium', 'Euph.', 'brass', 'brass', 'bass', InstrumentType.EUPHONIUM),
    simplePart('tuba', 'Tuba', 'Tba.', 'brass', 'brass', 'bass', InstrumentType.TUBA),
    simplePart('percussion', 'Percussion', 'Perc.', 'percussion', 'percussion', 'treble', InstrumentType.PERCUSSION),
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
