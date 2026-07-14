// src/utils/musicXmlExport.ts
// SavedScoreData を MusicXML 3.1 (partwise) 形式に変換してダウンロードする。

import type { SavedScoreData, NoteEvent, MeasureData } from '../types/storage';
import type { KeySignature } from './noteKeyUtils';

// 分割数（division）: 四分音符 = 16分割。全音符〜64分音符を整数で表せる最小値
const DIVISIONS = 16;

// 音価 → MusicXML duration（DIVISIONS基準） と type 文字列のマッピング
const DUR_TO_DIV: Record<string, number> = {
  '1': 64, '2': 32, '4': 16, '8': 8, '16': 4, '32': 2, '64': 1,
};
const DUR_TO_TYPE: Record<string, string> = {
  '1': 'whole', '2': 'half', '4': 'quarter', '8': 'eighth',
  '16': '16th', '32': '32nd', '64': '64th',
};

// 調号 → MusicXML fifths（五度圏インデックス）
const KEY_FIFTHS: Record<KeySignature, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
};

// 音部記号 → MusicXML clef (sign, line)
function clefXml(clef: 'treble' | 'bass' | 'alto'): string {
  if (clef === 'bass') return '<clef><sign>F</sign><line>4</line></clef>';
  if (clef === 'alto')  return '<clef><sign>C</sign><line>3</line></clef>';
  return '<clef><sign>G</sign><line>2</line></clef>';
}

/**
 * VexFlow 形式のキー文字列（"c/4", "f#/3", "bb/4"）を
 * MusicXML の pitch 要素に変換する。
 */
function keyToPitchXml(key: string): string {
  const m = key.match(/^([a-g])(#{1,2}|b{1,2})?\/(\d+)$/i);
  if (!m) return '';
  const step = m[1].toUpperCase();
  const acc = m[2] ?? '';
  const octave = m[3];
  // alter: # = +1, ## = +2, b = -1, bb = -2
  const alter = acc === '#' ? 1 : acc === '##' ? 2 : acc === 'b' ? -1 : acc === 'bb' ? -2 : 0;
  const alterXml = alter !== 0 ? `<alter>${alter}</alter>` : '';
  return `<pitch><step>${step}</step>${alterXml}<octave>${octave}</octave></pitch>`;
}

/** アーティキュレーション → MusicXML notations */
function articulationsXml(ev: NoteEvent): string {
  const arts = ev.articulations ?? [];
  if (!arts.length && !ev.ornament) return '';

  const artElems: string[] = [];
  for (const a of arts) {
    if (a === 'staccato') artElems.push('<staccato/>');
    else if (a === 'accent') artElems.push('<accent/>');
    else if (a === 'tenuto') artElems.push('<tenuto/>');
    else if (a === 'marcato') artElems.push('<strong-accent type="up"/>');
    else if (a === 'fermata') artElems.push('<fermata/>');
  }
  const articXml = artElems.length
    ? `<articulations>${artElems.join('')}</articulations>`
    : '';

  const ornamentXml = ev.ornament === 'trill'
    ? '<ornaments><trill-mark/></ornaments>'
    : '';

  return `<notations>${articXml}${ornamentXml}</notations>`;
}

/** 強弱記号 → MusicXML dynamics direction（音符の直前に配置する） */
function dynamicsDirectionXml(ev: NoteEvent, staff: number): string {
  const dyn = ev.dynamics?.find(d =>
    ['pp','p','mp','mf','f','ff'].includes(d.value)
  );
  if (!dyn) return '';
  return `<direction placement="below"><direction-type><dynamics><${dyn.value}/></dynamics></direction-type><staff>${staff}</staff></direction>`;
}

/** 付点の数から MusicXML の <dot/> 要素を繰り返す文字列を作る */
function dotsXml(ev: NoteEvent): string {
  const count = ev.dots === 1 ? 1 : ev.dots === 2 ? 2 : 0;
  return '<dot/>'.repeat(count);
}

/** NoteEvent 1つを MusicXML <note> 要素に変換する */
function noteToXml(
  ev: NoteEvent,
  voice: number,
  staff: number,
  tupletPos?: { isFirst: boolean; isLast: boolean }
): string {
  // 付点1個で1.5倍、複付点(2個)で1.75倍。四捨五入するのは、
  // DIVISIONS(16)を基準にすると 64分音符の複付点などで割り切れないことがあるため。
  const dotMultiplier = ev.dots === 1 ? 1.5 : ev.dots === 2 ? 1.75 : 1;
  // 連符（tuplet）は notesOccupied/numNotes 倍だけ実時間が短くなる（例: 3連符は 2/3 倍）
  const tupletMultiplier = ev.tuplet && ev.tuplet.numNotes ? ev.tuplet.notesOccupied / ev.tuplet.numNotes : 1;
  const dur = Math.round((DUR_TO_DIV[ev.dur] ?? 16) * dotMultiplier * tupletMultiplier);
  const type = DUR_TO_TYPE[ev.dur] ?? 'quarter';
  const dotXml = dotsXml(ev);
  const voiceXml = `<voice>${voice}</voice>`;
  const staffXml = `<staff>${staff}</staff>`;
  const artXml = articulationsXml(ev);
  // 連符情報: <time-modification> は実際の音数と本来の音数の比率、
  // <notations><tuplet .../></notations> はブラケットの開始/終了位置を表す
  let timeModXml = '';
  let tupletNotationXml = '';
  if (ev.tuplet) {
    timeModXml = `<time-modification><actual-notes>${ev.tuplet.numNotes}</actual-notes><normal-notes>${ev.tuplet.notesOccupied}</normal-notes></time-modification>`;
    const startTag = tupletPos?.isFirst ? '<tuplet type="start" number="1"/>' : '';
    const stopTag = tupletPos?.isLast ? '<tuplet type="stop" number="1"/>' : '';
    if (startTag || stopTag) {
      tupletNotationXml = `<notations>${startTag}${stopTag}</notations>`;
    }
  }

  if (ev.isRest) {
    return `<note><rest/><duration>${dur}</duration><type>${type}</type>${dotXml}${timeModXml}${voiceXml}${staffXml}${tupletNotationXml}</note>`;
  }

  // 和音: 最初の音符は通常、2音目以降は <chord/> を付ける
  const pitchNodes = ev.keys.map((k, idx) => {
    const pitchXml = keyToPitchXml(k);
    if (!pitchXml) return '';
    const chordTag = idx > 0 ? '<chord/>' : '';
    return `<note>${chordTag}${pitchXml}<duration>${dur}</duration><type>${type}</type>${dotXml}${timeModXml}${voiceXml}${staffXml}${artXml}${tupletNotationXml}</note>`;
  });
  return pitchNodes.join('');
}

/** 小節をまとめて XML に変換する */
function measureToXml(
  measure: MeasureData,
  measureNum: number,
  options: {
    clef: 'treble' | 'bass' | 'alto';
    globalKeyFifths: number;
    globalTimeSig: [number, number];
    isFirstMeasure: boolean;
    staff: number;
    prevTimeSig?: [number, number];
    prevKeyFifths?: number;
  }
): string {
  const lines: string[] = [];

  // attributes（最初の小節、または拍子・調号変更時に出力）
  const timeSig = measure.timeSignature ?? options.globalTimeSig;
  const keyFifths = options.globalKeyFifths;
  const timeSigChanged = options.prevTimeSig &&
    (timeSig[0] !== options.prevTimeSig[0] || timeSig[1] !== options.prevTimeSig[1]);

  if (options.isFirstMeasure || timeSigChanged) {
    const divXml = options.isFirstMeasure ? `<divisions>${DIVISIONS}</divisions>` : '';
    const keyXml = options.isFirstMeasure ? `<key><fifths>${keyFifths}</fifths><mode>major</mode></key>` : '';
    const timeXml = `<time><beats>${timeSig[0]}</beats><beat-type>${timeSig[1]}</beat-type></time>`;
    const clefXmlStr = options.isFirstMeasure ? clefXml(options.clef) : '';
    lines.push(`<attributes>${divXml}${keyXml}${timeXml}${clefXmlStr}</attributes>`);
  }

  // テンポ変更（BPM 指定がある場合）
  if (measure.bpm != null) {
    lines.push(
      `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${measure.bpm}</per-minute></metronome></direction-type><sound tempo="${measure.bpm}"/></direction>`
    );
  }

  // リピート開始
  if (measure.repeatStart) {
    lines.push('<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>');
  }

  // 音符・休符
  // 連符（tuplet）は同じ id の連続イベントが1グループなので、その先頭/末尾を判定して
  // <notations><tuplet type="start"/ "stop"/></notations> を出し分ける。
  const events = measure.events;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const dynDir = dynamicsDirectionXml(ev, options.staff);
    if (dynDir) lines.push(dynDir);
    let tupletPos: { isFirst: boolean; isLast: boolean } | undefined;
    if (ev.tuplet) {
      const isFirst = i === 0 || events[i - 1].tuplet?.id !== ev.tuplet.id;
      const isLast = i === events.length - 1 || events[i + 1].tuplet?.id !== ev.tuplet.id;
      tupletPos = { isFirst, isLast };
    }
    lines.push(noteToXml(ev, 1, options.staff, tupletPos));
  }

  // リピート終了
  if (measure.repeatEnd) {
    lines.push('<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>');
  }

  return `<measure number="${measureNum}">${lines.join('')}</measure>`;
}

/**
 * SavedScoreData を MusicXML 文字列に変換する。
 * @param data 楽譜データ
 * @returns MusicXML XML 文字列
 */
export function scoreToMusicXml(data: SavedScoreData): string {
  const { metadata, parts, keySignature = 'C', timeSignature = [4, 4] } = data;
  const globalKeyFifths = KEY_FIFTHS[keySignature as KeySignature] ?? 0;
  const globalTimeSig: [number, number] = [timeSignature[0], timeSignature[1]];

  // part-list
  const partListItems = parts.map((p, i) =>
    `<score-part id="P${i + 1}"><part-name>${p.partId}</part-name></score-part>`
  );

  // 各パートの小節 XML
  const partXmls = parts.map((p, pi) => {
    let prevTimeSig: [number, number] | undefined;
    const measuresXml = p.measures.map((m, mi) => {
      const xml = measureToXml(m, mi + 1, {
        clef: p.clef,
        globalKeyFifths,
        globalTimeSig,
        isFirstMeasure: mi === 0,
        staff: 1,
        prevTimeSig,
      });
      prevTimeSig = m.timeSignature ?? globalTimeSig;
      return xml;
    });
    return `<part id="P${pi + 1}">${measuresXml.join('')}</part>`;
  });

  const title = metadata.title || '無題';
  const composer = metadata.composer || '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${escXml(title)}</work-title></work>
  <identification>
    <creator type="composer">${escXml(composer)}</creator>
    <encoding><software>my-music-app</software></encoding>
  </identification>
  <part-list>${partListItems.join('')}</part-list>
  ${partXmls.join('\n  ')}
</score-partwise>`;
}

/** XML 特殊文字をエスケープする */
function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** MusicXML をファイルとしてダウンロードする */
export function downloadMusicXml(data: SavedScoreData, filename?: string): void {
  const xml = scoreToMusicXml(data);
  const blob = new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (filename ?? (data.metadata.title || '楽譜')) + '.musicxml';
  a.click();
  URL.revokeObjectURL(url);
}
