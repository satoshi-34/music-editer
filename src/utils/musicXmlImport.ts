// src/utils/musicXmlImport.ts
// MusicXML ファイルを SavedScoreData 形式にパースする。
// score-partwise 形式（Finale / Sibelius / MuseScore 等が出力する標準形式）に対応。

import type { SavedScoreData, MeasureData, NoteEvent, PartData } from '../types/storage';
import type { KeySignature } from './noteKeyUtils';
import { isValidKeySignature } from './noteKeyUtils';
import { isValidTimeSignature } from './timeSignatureUtils';

/** MusicXML の pitch 要素から VexFlow キー形式に変換する */
function pitchToKey(stepEl: Element | null, alterEl: Element | null, octaveEl: Element | null): string {
  const step = (stepEl?.textContent ?? 'C').toUpperCase();
  const alter = parseFloat(alterEl?.textContent ?? '0') || 0;
  const octave = parseInt(octaveEl?.textContent ?? '4', 10);
  const base = step.toLowerCase();
  const acc = alter === 1 ? '#' : alter === -1 ? 'b' : alter === 2 ? '##' : alter === -2 ? 'bb' : '';
  return `${base}${acc}/${octave}`;
}

/** MusicXML の type 要素から当アプリの音価 DurKey に変換する */
const TYPE_TO_DUR: Record<string, string> = {
  whole: '1', half: '2', quarter: '4', eighth: '8',
  '16th': '16', '32nd': '32', '64th': '64',
};

/** MusicXML の fifths 値から当アプリの調号文字列に変換する */
const FIFTHS_TO_KEY: Record<number, KeySignature> = {
  '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F',
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
};

/** note 要素群をまとめて MeasureData.events に変換する */
let tupletGroupCounter = 0;

function parseNotes(noteEls: Element[]): NoteEvent[] {
  const events: NoteEvent[] = [];
  let chordBuffer: NoteEvent | null = null;
  // 連符（tuplet）の読み込み: <time-modification> がある連続した note を
  // ひとまとまりのグループとみなし、共通の id を割り当てる。
  // MusicXML は明示的な <tuplet type="start"/"stop"/> でグループ境界を示すこともあるが、
  // ここでは「time-modification が連続しているかどうか」で十分に判定できる。
  let currentTupletId: string | null = null;
  let prevHadTimeMod = false;

  for (const noteEl of noteEls) {
    // 前打音は現状スキップ
    if (noteEl.querySelector('grace')) continue;

    const isChord = noteEl.querySelector('chord') !== null;
    const isRest = noteEl.querySelector('rest') !== null;
    const typeEl = noteEl.querySelector('type');
    const dur = TYPE_TO_DUR[typeEl?.textContent ?? ''] ?? '4';
    // <dot/> の数から付点(1個)・複付点(2個)を読み取る。3個以上は複付点として扱う（当アプリの上限が2のため）
    // :scope 疑似クラスが使えない環境もあるため、children を直接見て判定する
    const dotCount = Array.from(noteEl.children).filter((child) => child.tagName === 'dot').length;
    const dots: 1 | 2 | undefined = dotCount === 1 ? 1 : dotCount >= 2 ? 2 : undefined;

    // 連符（time-modification）の読み取り
    const timeModEl = noteEl.querySelector('time-modification');
    let tuplet: NoteEvent['tuplet'];
    if (timeModEl) {
      const actualNotes = parseInt(timeModEl.querySelector('actual-notes')?.textContent ?? '', 10);
      const normalNotes = parseInt(timeModEl.querySelector('normal-notes')?.textContent ?? '', 10);
      if (Number.isInteger(actualNotes) && actualNotes > 0 && Number.isInteger(normalNotes) && normalNotes > 0) {
        if (!prevHadTimeMod || !currentTupletId) {
          tupletGroupCounter += 1;
          currentTupletId = `xml-tuplet-${tupletGroupCounter}`;
        }
        tuplet = { id: currentTupletId, numNotes: actualNotes, notesOccupied: normalNotes };
      }
      prevHadTimeMod = true;
    } else {
      prevHadTimeMod = false;
      currentTupletId = null;
    }

    if (isRest) {
      if (chordBuffer) { events.push(chordBuffer); chordBuffer = null; }
      events.push({ dur: dur as any, isRest: true, keys: [], dots, tuplet });
      continue;
    }

    const step = noteEl.querySelector('step');
    const alter = noteEl.querySelector('alter');
    const octave = noteEl.querySelector('octave');
    const key = pitchToKey(step, alter, octave);

    if (isChord && chordBuffer) {
      // 和音: 前の音符に音高を追加する
      chordBuffer.keys.push(key);
    } else {
      if (chordBuffer) events.push(chordBuffer);
      chordBuffer = { dur: dur as any, isRest: false, keys: [key], dots, tuplet };

      // アーティキュレーションを読み込む
      const articulations: string[] = [];
      if (noteEl.querySelector('staccato')) articulations.push('staccato');
      if (noteEl.querySelector('accent')) articulations.push('accent');
      if (noteEl.querySelector('tenuto')) articulations.push('tenuto');
      if (noteEl.querySelector('strong-accent')) articulations.push('marcato');
      if (noteEl.querySelector('fermata')) articulations.push('fermata');
      if (articulations.length) chordBuffer.articulations = articulations as any;

      // 装飾記号（1音符につき1種類。複数該当する場合は最初に見つかったものを優先）
      if (noteEl.querySelector('trill-mark')) chordBuffer.ornament = 'trill';
      else if (noteEl.querySelector('mordent')) chordBuffer.ornament = 'mordent';
      else if (noteEl.querySelector('inverted-mordent')) chordBuffer.ornament = 'mordentInverted';
      else if (noteEl.querySelector('turn')) chordBuffer.ornament = 'turn';

      // 歌詞
      const lyricEl = noteEl.querySelector('lyric text');
      if (lyricEl?.textContent) chordBuffer.lyrics = lyricEl.textContent;
    }
  }
  if (chordBuffer) events.push(chordBuffer);
  return events;
}

/**
 * MusicXML 文字列を解析して SavedScoreData を返す。
 * @param xmlString MusicXML の文字列
 * @returns 解析結果
 * @throws パースに失敗した場合は Error をスロー
 */
export function parseMusicXml(xmlString: string): SavedScoreData {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  // パースエラーチェック（DOMParser はエラー時に parseerror 要素を返す）
  const parseError = doc.querySelector('parseerror');
  if (parseError) throw new Error(`MusicXML の解析に失敗しました: ${parseError.textContent}`);

  // score-partwise のみ対応（score-timewise は変換不要）
  const root = doc.querySelector('score-partwise');
  if (!root) throw new Error('score-partwise 形式の MusicXML のみ対応しています');

  // タイトル・作曲者
  const title = doc.querySelector('work-title')?.textContent ?? '';
  const composer = doc.querySelector('creator[type="composer"]')?.textContent ?? '';

  // デフォルト設定（最初の attributes から取得する）
  let globalKeyFifths = 0;
  let globalTimeSig: [number, number] = [4, 4];
  let defaultClef: 'treble' | 'bass' | 'alto' = 'treble';

  // 最初のパートの最初の小節の attributes を見てグローバル設定を取得
  const firstAttrs = doc.querySelector('measure attributes');
  if (firstAttrs) {
    const fifths = parseInt(firstAttrs.querySelector('fifths')?.textContent ?? '0', 10);
    if (!isNaN(fifths) && fifths >= -7 && fifths <= 7) globalKeyFifths = fifths;

    const beats = parseInt(firstAttrs.querySelector('time beats')?.textContent ?? '4', 10);
    const beatType = parseInt(firstAttrs.querySelector('time beat-type')?.textContent ?? '4', 10);
    if (isValidTimeSignature([beats, beatType])) globalTimeSig = [beats, beatType];

    const clefSign = firstAttrs.querySelector('clef sign')?.textContent ?? 'G';
    defaultClef = clefSign === 'F' ? 'bass' : clefSign === 'C' ? 'alto' : 'treble';
  }

  const keySignature: KeySignature = FIFTHS_TO_KEY[globalKeyFifths] ?? 'C';
  const validKey = isValidKeySignature(keySignature) ? keySignature : 'C';

  // パート一覧
  const partEls = Array.from(doc.querySelectorAll('part'));
  const parts: PartData[] = partEls.map((partEl, pi) => {
    const partId = partEl.getAttribute('id') ?? `P${pi + 1}`;
    const scorePartEl = doc.querySelector(`score-part[id="${partId}"]`);
    const partName = scorePartEl?.querySelector('part-name')?.textContent ?? partId;

    // 音部記号（パートごとに取得）
    const firstPartAttrs = partEl.querySelector('attributes');
    let clef: 'treble' | 'bass' | 'alto' = defaultClef;
    if (firstPartAttrs) {
      const sign = firstPartAttrs.querySelector('clef sign')?.textContent ?? 'G';
      clef = sign === 'F' ? 'bass' : sign === 'C' ? 'alto' : 'treble';
    }

    const measureEls = Array.from(partEl.querySelectorAll('measure'));
    const measures: MeasureData[] = measureEls.map((measureEl, mi) => {
      const noteEls = Array.from(measureEl.querySelectorAll('note'));
      const events = parseNotes(noteEls);

      // リピート
      const leftBarline = measureEl.querySelector('barline[location="left"] repeat');
      const rightBarline = measureEl.querySelector('barline[location="right"] repeat');

      // 小節単位テンポ（sound/@tempo があれば取得）
      const soundEl = measureEl.querySelector('sound[tempo]');
      const bpm = soundEl ? parseInt(soundEl.getAttribute('tempo') ?? '', 10) : undefined;

      // 小節単位拍子変更
      const attrEl = measureEl.querySelector('attributes time');
      let timeSig: [number, number] | undefined;
      if (attrEl) {
        const b = parseInt(attrEl.querySelector('beats')?.textContent ?? '', 10);
        const bt = parseInt(attrEl.querySelector('beat-type')?.textContent ?? '', 10);
        if (!isNaN(b) && !isNaN(bt) && isValidTimeSignature([b, bt])) {
          timeSig = [b, bt];
        }
      }

      // 小節単位調号変更（先頭小節はグローバル調号として別に扱うため、2小節目以降のみ拾う）
      let measureKeySig: KeySignature | undefined;
      if (mi > 0) {
        const keyEl = measureEl.querySelector('key fifths');
        if (keyEl) {
          const fifths = parseInt(keyEl.textContent ?? '', 10);
          if (!isNaN(fifths) && fifths >= -7 && fifths <= 7) {
            const ks = FIFTHS_TO_KEY[fifths];
            if (ks && isValidKeySignature(ks)) measureKeySig = ks;
          }
        }
      }

      return {
        events: events.length ? events : [{ dur: '1', isRest: true, keys: [] }],
        repeatStart: leftBarline?.getAttribute('direction') === 'forward' ? true : undefined,
        repeatEnd: rightBarline?.getAttribute('direction') === 'backward' ? true : undefined,
        bpm: bpm && !isNaN(bpm) ? bpm : undefined,
        timeSignature: timeSig,
        keySignature: measureKeySig,
      };
    });

    return {
      partId: partName,
      clef,
      measures: measures.length ? measures : [{ events: [{ dur: '1', isRest: true, keys: [] }] }],
    };
  });

  // score type は partの数で推定
  const scoreType = parts.length >= 4 ? 'ensemble' : parts.length === 2 ? 'piano' : 'single';

  return {
    version: '1.0',
    timestamp: Date.now(),
    metadata: {
      title,
      subtitle: '',
      lyricist: '',
      composer,
      arranger: '',
    },
    scoreType,
    keySignature: validKey,
    timeSignature: globalTimeSig,
    parts,
    systems: 6,
    measuresPerSystem: 4,
  };
}
