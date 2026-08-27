// src/utils/musicXmlExport.ts
// SavedScoreData を MusicXML 3.1 (partwise) 形式に変換してダウンロードする。

import type { SavedScoreData, NoteEvent, MeasureData, TimeSignatureStyle } from '../types/storage';
import type { KeySignature } from './noteKeyUtils';
import type { ClefType } from '../components/clefUtils';
import { resolveMeasureClef, resolveClefAtMeasureEnd } from './clefMeasureUtils';
import { getMeasureVoices, getPrimaryVoiceEvents, getVoiceEvents, syncMeasuresPrimaryVoiceFromEvents } from './voiceMeasureUtils';

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
function clefXml(clef: ClefType): string {
  if (clef === 'bass') return '<clef><sign>F</sign><line>4</line></clef>';
  if (clef === 'alto')  return '<clef><sign>C</sign><line>3</line></clef>';
  if (clef === 'tenor') return '<clef><sign>C</sign><line>4</line></clef>';
  return '<clef><sign>G</sign><line>2</line></clef>';
}

/**
 * VexFlow 形式のキー文字列（"c/4", "f#/3", "bb/4"）を
 * MusicXML の pitch 要素に変換する。
 */
function keyToPitchXml(key: string, microtoneType?: 'quarterSharp' | 'quarterFlat'): string {
  const m = key.match(/^([a-g])(#{1,2}|b{1,2})?\/(\d+)$/i);
  if (!m) return '';
  const step = m[1].toUpperCase();
  const acc = m[2] ?? '';
  const octave = m[3];
  // alter: # = +1, ## = +2, b = -1, bb = -2
  // 微分音（四分音）は MusicXML では小数の alter（+0.5 / -0.5）で表す。
  // 通常の ♯/♭ とは排他（keys 側は setKeyAccidental で 'natural' に揃えてから microtones を付けているため、
  // ここで acc と microtone が同時に付くことは通常ない）。
  const alter = microtoneType === 'quarterSharp'
    ? 0.5
    : microtoneType === 'quarterFlat'
      ? -0.5
      : (acc === '#' ? 1 : acc === '##' ? 2 : acc === 'b' ? -1 : acc === 'bb' ? -2 : 0);
  const alterXml = alter !== 0 ? `<alter>${alter}</alter>` : '';
  return `<pitch><step>${step}</step>${alterXml}<octave>${octave}</octave></pitch>`;
}

/**
 * 微分音（四分音）の <accidental> 要素。
 * MusicXML の要素順序では <type>/<dot> の後・<time-modification> の前に置く必要があるため、
 * keyToPitchXml とは別関数にして noteToXml 側で正しい位置に挿入する。
 */
function microtoneAccidentalXml(microtoneType?: 'quarterSharp' | 'quarterFlat'): string {
  if (microtoneType === 'quarterSharp') return '<accidental>quarter-sharp</accidental>';
  if (microtoneType === 'quarterFlat') return '<accidental>quarter-flat</accidental>';
  return '';
}

/**
 * アーティキュレーション・装飾記号・運指番号 → MusicXML notations
 * fingerValue はこの note 要素（和音の場合は1つの音）に対応する運指番号（1文字〜数文字）。
 * 和音で '1,3,5' のように複数指定されている場合は、呼び出し側で音ごとに分割して渡す。
 */
function articulationsXml(ev: NoteEvent, fingerValue?: string): string {
  const arts = ev.articulations ?? [];
  if (!arts.length && !ev.ornament && !fingerValue) return '';

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

  // 装飾記号 → MusicXML の <ornaments> 子要素。
  // 'mordent'(下/モルデント) は MusicXML の <mordent/>、
  // 'mordentInverted'(上/プラルトリラー) は <inverted-mordent/> に対応する
  // （MusicXML の命名は音楽用語通りで、VexFlow のようなねじれはない）。
  const ornamentXml = ev.ornament === 'trill' ? '<ornaments><trill-mark/></ornaments>'
    : ev.ornament === 'mordent' ? '<ornaments><mordent/></ornaments>'
    : ev.ornament === 'mordentInverted' ? '<ornaments><inverted-mordent/></ornaments>'
    : ev.ornament === 'turn' ? '<ornaments><turn/></ornaments>'
    : '';

  // 運指番号 → <technical><fingering>N</fingering></technical>
  const fingeringXml = fingerValue ? `<technical><fingering>${escapeXmlText(fingerValue)}</fingering></technical>` : '';

  return `<notations>${articXml}${ornamentXml}${fingeringXml}</notations>`;
}

/** XML テキストとして安全に埋め込めるようエスケープする */
function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 強弱記号 → MusicXML dynamics direction（音符の直前に配置する） */
function dynamicsDirectionXml(ev: NoteEvent, staff: number): string {
  const dyn = ev.dynamics?.find(d =>
    ['pp','p','mp','mf','f','ff'].includes(d.value)
  );
  if (!dyn) return '';
  return `<direction placement="below"><direction-type><dynamics><${dyn.value}/></dynamics></direction-type><staff>${staff}</staff></direction>`;
}

/**
 * 松葉（ヘアピン）の開始/終了位置マップ。
 * キーはどちらも `${小節の絶対インデックス}-${イベントのインデックス}`。
 * starts は「その位置から始まる松葉の種類の一覧」、stops は「その位置で終わる松葉の本数」。
 */
type HairpinPositionMaps = {
  starts: Map<string, Array<'crescendo' | 'diminuendo'>>;
  stops: Map<string, number>;
};

/** 松葉（ヘアピン）1つぶんの <direction> 要素を作る（開始・終了で同じ形なので共通化） */
function wedgeDirectionXml(wedgeType: 'crescendo' | 'diminuendo' | 'stop', staff: number): string {
  return `<direction placement="below"><direction-type><wedge type="${wedgeType}"/></direction-type><staff>${staff}</staff></direction>`;
}

/**
 * 松葉（ヘアピン）の開始/終了位置マップを「パート内の1つの声部」ぶんだけ作る。
 * MusicXML の <wedge> は「開始位置に type="crescendo|diminuendo"、
 * 終了位置に type="stop"」を direction として置く方式のため、
 * 開始音符に保持しているデータ（endMeasure / endEvent）を
 * 「この小節・このイベントの直前/直後に direction を出す」形へ変換しておく。
 *
 * 声部ごとに別々のマップを作るのは、松葉の始点と終点が必ず同じ声部の中で閉じる
 * （設計メモ `.claude/specs/voice2-arc-support/design.md` §2 の案A）ため。
 * こうしておくと、声部1と声部2の同じ位置（例: どちらも 0 小節目の 0 番目）に
 * 松葉があってもキーが衝突しない。
 *
 * @param voiceIndex 0 = 声部1（measure.events）、1 = 声部2（measure.voices[1]）。
 *   既定を 0 にしてあるので、声部1だけを扱っていた既存の呼び出しはそのまま動く。
 */
export function buildHairpinPositionMaps(measures: MeasureData[], voiceIndex = 0): HairpinPositionMaps {
  const starts = new Map<string, Array<'crescendo' | 'diminuendo'>>();
  const stops = new Map<string, number>();
  measures.forEach((measure, mi) => {
    getVoiceEvents(measure, voiceIndex).forEach((ev, ei) => {
      ev.hairpins?.forEach((h) => {
        const startKey = `${mi}-${ei}`;
        const list = starts.get(startKey) ?? [];
        list.push(h.type === 'cresc' ? 'crescendo' : 'diminuendo');
        starts.set(startKey, list);
        const stopKey = `${h.endMeasure}-${h.endEvent}`;
        stops.set(stopKey, (stops.get(stopKey) ?? 0) + 1);
      });
    });
  });
  return { starts, stops };
}

/** 付点の数から MusicXML の <dot/> 要素を繰り返す文字列を作る */
function dotsXml(ev: NoteEvent): string {
  const count = ev.dots === 1 ? 1 : ev.dots === 2 ? 2 : 0;
  return '<dot/>'.repeat(count);
}

/**
 * NoteEvent 1つぶんの MusicXML duration（DIVISIONS 基準の整数）を計算する。
 * <backup> で声部2の開始位置へ戻すときの合計にも使うため、noteToXml と共通化しておく。
 */
function eventDurationTicks(ev: NoteEvent): number {
  // 付点1個で1.5倍、複付点(2個)で1.75倍。四捨五入するのは、
  // DIVISIONS(16)を基準にすると 64分音符の複付点などで割り切れないことがあるため。
  const dotMultiplier = ev.dots === 1 ? 1.5 : ev.dots === 2 ? 1.75 : 1;
  // 連符（tuplet）は notesOccupied/numNotes 倍だけ実時間が短くなる（例: 3連符は 2/3 倍）
  const tupletMultiplier = ev.tuplet && ev.tuplet.numNotes ? ev.tuplet.notesOccupied / ev.tuplet.numNotes : 1;
  return Math.round((DUR_TO_DIV[ev.dur] ?? 16) * dotMultiplier * tupletMultiplier);
}

/** NoteEvent 1つを MusicXML <note> 要素に変換する */
function noteToXml(
  ev: NoteEvent,
  voice: number,
  staff: number,
  tupletPos?: { isFirst: boolean; isLast: boolean }
): string {
  const dur = eventDurationTicks(ev);
  const type = DUR_TO_TYPE[ev.dur] ?? 'quarter';
  const dotXml = dotsXml(ev);
  const voiceXml = `<voice>${voice}</voice>`;
  const staffXml = `<staff>${staff}</staff>`;
  // 運指番号: 単音なら丸ごと1つの音符に、和音なら 'カンマ区切り' を音の順番に割り当てる
  const fingerParts = ev.fingering ? ev.fingering.split(',').map(s => s.trim()).filter(Boolean) : [];
  // 連符情報: <time-modification> は実際の音数と本来の音数の比率、
  // <notations><tuplet .../></notations> はブラケットの開始/終了位置を表す
  let timeModXml = '';
  let tupletNotationXml = '';
  if (ev.tuplet) {
    timeModXml = `<time-modification><actual-notes>${ev.tuplet.numNotes}</actual-notes><normal-notes>${ev.tuplet.notesOccupied}</normal-notes></time-modification>`;
    // 連符数字を隠すグループ（Issue #269）は、他ソフトでも同じ見た目になるよう
    // show-number="none"（数字を出さない）と bracket="no"（括弧も出さない）を付ける。
    // アプリ側も「数字を消したら括弧も消す」挙動なので、書出と表示が一致する。
    const hideAttrs = ev.tuplet.hideNumber ? ' bracket="no" show-number="none"' : '';
    const startTag = tupletPos?.isFirst ? `<tuplet type="start" number="1"${hideAttrs}/>` : '';
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
    const microtone = ev.microtones?.find(m => m.keyIndex === idx);
    const pitchXml = keyToPitchXml(k, microtone?.type);
    if (!pitchXml) return '';
    const chordTag = idx > 0 ? '<chord/>' : '';
    // 単音（fingerParts が1個）ならその音に、和音なら順番に対応する指番号を割り当てる
    const fingerValue = fingerParts[idx];
    const artXml = articulationsXml(ev, fingerValue);
    const accidentalXml = microtoneAccidentalXml(microtone?.type);
    return `<note>${chordTag}${pitchXml}<duration>${dur}</duration><type>${type}</type>${dotXml}${accidentalXml}${timeModXml}${voiceXml}${staffXml}${artXml}${tupletNotationXml}</note>`;
  });
  return pitchNodes.join('');
}

/** 小節をまとめて XML に変換する */
function measureToXml(
  measure: MeasureData,
  measureNum: number,
  options: {
    clef: ClefType;
    prevClef?: ClefType;
    globalKeyFifths: number;
    globalTimeSig: [number, number];
    isFirstMeasure: boolean;
    staff: number;
    prevTimeSig?: [number, number];
    prevKeyFifths?: number;
    effectiveKeyFifths: number;
    /** 声部1の松葉（ヘアピン）の開始/終了位置マップ（パート全体で事前計算したもの） */
    hairpins?: HairpinPositionMaps;
    /** 声部2の松葉（ヘアピン）の開始/終了位置マップ（同上・声部ごとに別マップ） */
    hairpinsVoice2?: HairpinPositionMaps;
    /** この小節の絶対インデックス（hairpins のキー照合に使う） */
    measureIndex?: number;
    /**
     * 拍子記号の表示スタイル（Issue #422）。'symbol' のとき MusicXML の
     * <time symbol="common"/"cut"> 属性を付けて、他ソフトでも C・𝄵 で開けるようにする。
     */
    timeSignatureStyle?: TimeSignatureStyle;
  }
): string {
  const lines: string[] = [];

  // attributes（最初の小節、または拍子・調号変更時に出力）
  const timeSig = measure.timeSignature ?? options.globalTimeSig;
  const keyFifths = options.effectiveKeyFifths;
  const timeSigChanged = options.prevTimeSig &&
    (timeSig[0] !== options.prevTimeSig[0] || timeSig[1] !== options.prevTimeSig[1]);
  // 途中調号変更: この小節に keySignature 指定があり、直前の調号と異なるときだけ出力する
  const keyChanged = options.prevKeyFifths !== undefined && keyFifths !== options.prevKeyFifths;
  // 途中クレフ変更: この小節時点で有効なクレフが直前の小節と異なるときだけ出力する
  const clefChanged = options.prevClef !== undefined && options.clef !== options.prevClef;

  if (options.isFirstMeasure || timeSigChanged || keyChanged || clefChanged) {
    const divXml = options.isFirstMeasure ? `<divisions>${DIVISIONS}</divisions>` : '';
    const keyXml = (options.isFirstMeasure || keyChanged) ? `<key><fifths>${keyFifths}</fifths><mode>major</mode></key>` : '';
    // symbol 属性は 4/4（common）と 2/2（cut）にだけ意味がある。
    // それ以外の拍子で付けると、読み込む側が「数字なのに記号指定」と解釈して崩れるため付けない。
    // 記号表記の対象は**譜面先頭の拍子だけ**にする（#422 round1 P2）。小節単位の
    // 拍子変更へ付けると、読込側は先頭しか見ないため往復でスタイルが消える。
    // 途中の拍子変更はデータのみ（画面表示も未対応の既存仕様）なので数字のまま出す
    const timeSymbol = options.isFirstMeasure && options.timeSignatureStyle === 'symbol'
      ? timeSig[0] === 4 && timeSig[1] === 4
        ? ' symbol="common"'
        : timeSig[0] === 2 && timeSig[1] === 2
          ? ' symbol="cut"'
          : ''
      : '';
    const timeXml = `<time${timeSymbol}><beats>${timeSig[0]}</beats><beat-type>${timeSig[1]}</beat-type></time>`;
    const clefXmlStr = (options.isFirstMeasure || clefChanged) ? clefXml(options.clef) : '';
    lines.push(`<attributes>${divXml}${keyXml}${timeXml}${clefXmlStr}</attributes>`);
  }

  // テンポ変更（BPM 指定がある場合）
  if (measure.bpm != null) {
    lines.push(
      `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${measure.bpm}</per-minute></metronome></direction-type><sound tempo="${measure.bpm}"/></direction>`
    );
  }

  // リハーサルマーク（練習番号）: MusicXML の標準的な <rehearsal> 要素で出力する
  if (measure.rehearsalMark) {
    lines.push(
      `<direction placement="above"><direction-type><rehearsal>${escapeXmlText(measure.rehearsalMark)}</rehearsal></direction-type></direction>`
    );
  }

  // リピート開始
  if (measure.repeatStart) {
    lines.push('<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>');
  }

  // 音符・休符
  // 連符（tuplet）は同じ id の連続イベントが1グループなので、その先頭/末尾を判定して
  // <notations><tuplet type="start"/ "stop"/></notations> を出し分ける。
  const events = getPrimaryVoiceEvents(measure);
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    // 小節途中でのクレフ変更（Issue #424）: MusicXML では小節の途中にも <attributes> を
    // 置けるので、変更が付いたイベントの**直前**に <clef> だけの <attributes> を出す。
    // 楽譜上も小型のクレフはその音符の手前に描かれるので、順序はこれで一致する。
    if (ev.clefChange) {
      lines.push(`<attributes>${clefXml(ev.clefChange)}</attributes>`);
    }
    const dynDir = dynamicsDirectionXml(ev, options.staff);
    if (dynDir) lines.push(dynDir);
    // 松葉（ヘアピン）開始: この音符の直前に <wedge type="crescendo|diminuendo"/> を置く
    const hpKey = `${options.measureIndex ?? 0}-${i}`;
    options.hairpins?.starts.get(hpKey)?.forEach((wedgeType) => {
      lines.push(wedgeDirectionXml(wedgeType, options.staff));
    });
    let tupletPos: { isFirst: boolean; isLast: boolean } | undefined;
    if (ev.tuplet) {
      const isFirst = i === 0 || events[i - 1].tuplet?.id !== ev.tuplet.id;
      const isLast = i === events.length - 1 || events[i + 1].tuplet?.id !== ev.tuplet.id;
      tupletPos = { isFirst, isLast };
    }
    lines.push(noteToXml(ev, 1, options.staff, tupletPos));
    // 松葉（ヘアピン）終了: 終了音符の直後に <wedge type="stop"/> を置く
    const stopCount = options.hairpins?.stops.get(hpKey) ?? 0;
    for (let k = 0; k < stopCount; k++) {
      lines.push(wedgeDirectionXml('stop', options.staff));
    }
  }

  // 追加声部（voices[1] 以降）: 入力されている声部だけ <backup> で小節頭へ巻き戻してから出力する。
  // <backup> は「今の書き出し位置を duration ぶん巻き戻す」指示なので、これ以降に並べた
  // 音符・direction はすべてその声部の側に属する（読込側も <backup> を境に声部を分けている）。
  // #244 段5-5: 旧実装は voices[1]（声部2）の明示参照だった。§2-5 完了条件に従い
  // 全声部ループへ一般化（2声のときの出力は従来と同一。3声以降も「壊れず全声部が出る」）。
  // 松葉の位置マップ（hairpinsVoice2）は現行 UI が2声までなので声部2にだけ適用する。
  const voicesForXml = getMeasureVoices(measure);
  let prevWrittenVoiceTicks = events.reduce((sum, ev) => sum + eventDurationTicks(ev), 0);
  voicesForXml.slice(1).forEach((voice, extraIndex) => {
    const voiceEvents = voice.events;
    if (voiceEvents.length === 0) return;
    const voiceNumber = extraIndex + 2;
    lines.push(`<backup><duration>${prevWrittenVoiceTicks}</duration></backup>`);
    voiceEvents.forEach((ev, i) => {
      // 声部2の松葉（ヘアピン）も声部1と同じ並び（開始音符の直前・終了音符の直後）で出す。
      // 位置マップは声部2ぶんを別に受け取っているので、声部1の松葉と混ざることはない。
      const hpKey = `${options.measureIndex ?? 0}-${i}`;
      if (voiceNumber === 2) {
        options.hairpinsVoice2?.starts.get(hpKey)?.forEach((wedgeType) => {
          lines.push(wedgeDirectionXml(wedgeType, options.staff));
        });
      }
      lines.push(noteToXml(ev, voiceNumber, options.staff));
      if (voiceNumber === 2) {
        const stopCount = options.hairpinsVoice2?.stops.get(hpKey) ?? 0;
        for (let k = 0; k < stopCount; k++) {
          lines.push(wedgeDirectionXml('stop', options.staff));
        }
      }
    });
    prevWrittenVoiceTicks = voiceEvents.reduce((sum, ev) => sum + eventDurationTicks(ev), 0);
  });

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
  const { metadata, keySignature = 'C', timeSignature = [4, 4], timeSignatureStyle } = data;
  // 書き出し境界の正規化（#244 段5-3）: read は voices[0]（鏡）を優先するため、
  // 呼び出し側から鏡が古いデータ（旧バージョン由来・手組みのテストデータ等）が来ても
  // 正本（events）から同期してから書き出す。アプリ内の通常経路では dual-write 済みで no-op
  const parts = data.parts.map((p) => ({ ...p, measures: syncMeasuresPrimaryVoiceFromEvents(p.measures) }));
  const globalKeyFifths = KEY_FIFTHS[keySignature as KeySignature] ?? 0;
  const globalTimeSig: [number, number] = [timeSignature[0], timeSignature[1]];

  // part-list
  const partListItems = parts.map((p, i) =>
    `<score-part id="P${i + 1}"><part-name>${p.partId}</part-name></score-part>`
  );

  // 各パートの小節 XML
  const partXmls = parts.map((p, pi) => {
    let prevTimeSig: [number, number] | undefined;
    let effectiveKeyFifths = globalKeyFifths;
    let prevKeyFifths: number | undefined;
    let prevClef: ClefType | undefined;
    // 松葉（ヘアピン）の開始/終了位置をパート全体で事前計算しておく（声部ごとに別マップ）
    const hairpins = buildHairpinPositionMaps(p.measures, 0);
    const hairpinsVoice2 = buildHairpinPositionMaps(p.measures, 1);
    const measuresXml = p.measures.map((m, mi) => {
      // 途中調号変更: この小節に keySignature があれば、それ以降有効な調号として更新する
      if (m.keySignature) {
        effectiveKeyFifths = KEY_FIFTHS[m.keySignature as KeySignature] ?? effectiveKeyFifths;
      }
      // 途中クレフ変更: この小節時点で有効なクレフを解決する
      const effectiveClef = resolveMeasureClef(p.measures, mi, p.clef);
      const xml = measureToXml(m, mi + 1, {
        clef: effectiveClef,
        prevClef,
        globalKeyFifths,
        globalTimeSig,
        isFirstMeasure: mi === 0,
        staff: 1,
        prevTimeSig,
        prevKeyFifths,
        effectiveKeyFifths,
        hairpins,
        hairpinsVoice2,
        measureIndex: mi,
        timeSignatureStyle,
      });
      // 引き継ぐのは「小節の**末尾**時点」のクレフ。小節途中で変わった場合に
      // 先頭時点の値を引き継ぐと、次の小節の頭で同じクレフをもう一度出力してしまう
      // （読み込む側では冒頭にクレフが二重に出る）。
      prevClef = resolveClefAtMeasureEnd(getPrimaryVoiceEvents(m), effectiveClef);
      prevTimeSig = m.timeSignature ?? globalTimeSig;
      prevKeyFifths = effectiveKeyFifths;
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
    <encoding><software>my-music-app</software></encoding>${timeSignatureStyle === 'symbol'
      // 拍子の記号表示設定（#422）。<time symbol> は先頭が 4/4・2/2 のときしか
      // 書けないため、6/8 等へ変更中でも設定を往復させるにはアプリ固有メタが要る。
      // MusicXML 公式のアプリ固有情報置き場（miscellaneous-field）を使う（round3 P2）。
      // numeric（既定）のときは改行ごと何も足さない（従来出力と1バイトも変えない）
      ? '\n    <miscellaneous><miscellaneous-field name="music-editer.time-signature-style">symbol</miscellaneous-field></miscellaneous>'
      : ''}
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
