// src/utils/musicXmlImport.ts
// MusicXML ファイルを SavedScoreData 形式にパースする。
// score-partwise 形式（Finale / Sibelius / MuseScore 等が出力する標準形式）に対応。

import type { SavedScoreData, MeasureData, NoteEvent, PartData, HairpinMark } from '../types/storage';
import type { ClefType } from '../components/clefUtils';
import type { KeySignature } from './noteKeyUtils';
import { isValidKeySignature } from './noteKeyUtils';
import { isValidTimeSignature } from './timeSignatureUtils';
import { ensureMeasuresPrimaryVoiceMaterialized } from './voiceMeasureUtils';

/**
 * MusicXML の <clef><sign>/<line> を ClefType に変換する。
 * C 記号は line によってアルト記号（3線目）とテナー記号（4線目）を区別する。
 */
function xmlClefToClefType(sign: string, line?: string | null): ClefType {
  if (sign === 'F') return 'bass';
  if (sign === 'C') return line === '4' ? 'tenor' : 'alto';
  return 'treble';
}

/** MusicXML の pitch 要素から VexFlow キー形式に変換する */
function pitchToKey(stepEl: Element | null, alterEl: Element | null, octaveEl: Element | null): string {
  const step = (stepEl?.textContent ?? 'C').toUpperCase();
  const alter = parseFloat(alterEl?.textContent ?? '0') || 0;
  const octave = parseInt(octaveEl?.textContent ?? '4', 10);
  const base = step.toLowerCase();
  // 微分音（alter = ±0.5）は keys 文字列には反映しない（自然音の綴りのまま）。
  // これは書出側（musicXmlExport.ts の keyToPitchXml）と同じ方針: keys は変更せず、
  // 微分音の情報は NoteEvent.microtones に独立して持たせる。
  const acc = alter === 1 ? '#' : alter === -1 ? 'b' : alter === 2 ? '##' : alter === -2 ? 'bb' : '';
  return `${base}${acc}/${octave}`;
}

/**
 * MusicXML の <note> から微分音（四分音）種別を読み取る。
 * 書出側（musicXmlExport.ts）は alter に 0.5/-0.5 と <accidental>quarter-sharp|quarter-flat</accidental>
 * の両方を出力しているため、どちらからでも判定できるようにしておく。
 */
function readMicrotoneType(noteEl: Element, alterEl: Element | null): 'quarterSharp' | 'quarterFlat' | undefined {
  const accidentalText = noteEl.querySelector('accidental')?.textContent?.trim();
  if (accidentalText === 'quarter-sharp') return 'quarterSharp';
  if (accidentalText === 'quarter-flat') return 'quarterFlat';
  const alter = parseFloat(alterEl?.textContent ?? '0') || 0;
  if (alter === 0.5) return 'quarterSharp';
  if (alter === -0.5) return 'quarterFlat';
  return undefined;
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
    const microtoneType = readMicrotoneType(noteEl, alter);

    if (isChord && chordBuffer) {
      // 和音: 前の音符に音高を追加する
      const keyIndex = chordBuffer.keys.length;
      chordBuffer.keys.push(key);
      if (microtoneType) {
        chordBuffer.microtones = [...(chordBuffer.microtones ?? []), { keyIndex, type: microtoneType }];
      }
      // この音にも運指番号があれば、既存の運指リストにカンマ区切りで追加する
      // （和音の音の順番と運指番号の順番を対応させるため）
      const chordFingerEl = noteEl.querySelector('technical fingering');
      if (chordFingerEl?.textContent) {
        chordBuffer.fingering = chordBuffer.fingering
          ? `${chordBuffer.fingering},${chordFingerEl.textContent.trim()}`
          : chordFingerEl.textContent.trim();
      }
    } else {
      if (chordBuffer) events.push(chordBuffer);
      chordBuffer = { dur: dur as any, isRest: false, keys: [key], dots, tuplet };
      if (microtoneType) {
        chordBuffer.microtones = [{ keyIndex: 0, type: microtoneType }];
      }

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

      // 運指番号（この音符の1音目ぶん。和音の2音目以降は isChord 分岐側で追加する）
      const fingerEl = noteEl.querySelector('technical fingering');
      if (fingerEl?.textContent) chordBuffer.fingering = fingerEl.textContent.trim();
    }
  }
  if (chordBuffer) events.push(chordBuffer);
  return events;
}

/**
 * 松葉（ヘアピン）を1つの声部の NoteEvent へ復元する。
 * 書出側（musicXmlExport.ts）は
 * 「開始音符の直前に <direction><wedge type="crescendo|diminuendo"/></direction>」
 * 「終了音符の直後に <direction><wedge type="stop"/></direction>」
 * という並びで出力しているため、<measure> の直下の子要素（note と direction）を
 * 出現順に読み、直前/直後の note との対応を追いながら組み立てる。
 *
 * 声部1（<backup> より前）と声部2（<backup> より後）で同じ処理が使えるので、
 * 呼び出し側が「その声部ぶんの子要素・イベント配列・待ち行列」を渡す形にしてある。
 *
 * @param children その声部に属する <measure> 直下の子要素（声部1なら <backup> より前、声部2なら後）
 * @param events parseNotes(その声部のnoteEls) の結果。ここへ hairpins を直接書き込む
 * @param measureIndex この小節の絶対インデックス（HairpinMark.endMeasure に使う）
 * @param openRefs まだ <wedge type="stop"/> に出会っていない HairpinMark の待ち行列。
 *   パート全体で1つを使い回すことで、小節をまたぐ松葉にも対応する（FIFO想定）。
 *   声部をまたぐ松葉は作らない設計なので、待ち行列も声部ごとに分ける
 *   （混ぜると声部1の stop が声部2の松葉を閉じてしまう）。
 */
function attachHairpinsToVoiceEvents(
  children: Element[],
  events: NoteEvent[],
  measureIndex: number,
  openRefs: HairpinMark[],
): void {
  let eventIndex = -1;
  let pendingTypes: Array<'cresc' | 'dim'> = [];

  for (const child of children) {
    if (child.tagName === 'direction') {
      const wedgeType = child.querySelector('wedge')?.getAttribute('type');
      if (wedgeType === 'crescendo') pendingTypes.push('cresc');
      else if (wedgeType === 'diminuendo') pendingTypes.push('dim');
      else if (wedgeType === 'stop') {
        const ref = openRefs.shift();
        if (ref && eventIndex >= 0) {
          ref.endMeasure = measureIndex;
          ref.endEvent = eventIndex;
        }
      }
      continue;
    }
    if (child.tagName !== 'note') continue;
    // parseNotes と同じ判定（前打音はスキップ、和音の2音目以降は新しい event を作らない）
    if (child.querySelector('grace')) continue;
    const isChordNote = child.querySelector('chord') !== null;
    if (isChordNote) continue;
    eventIndex += 1;
    if (pendingTypes.length === 0) continue;
    const ev = events[eventIndex];
    if (!ev) continue;
    for (const type of pendingTypes) {
      const mark: HairpinMark = { type, endMeasure: measureIndex, endEvent: eventIndex };
      ev.hairpins = [...(ev.hairpins ?? []), mark];
      openRefs.push(mark);
    }
    pendingTypes = [];
  }
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
  let defaultClef: ClefType = 'treble';

  // 最初のパートの最初の小節の attributes を見てグローバル設定を取得
  const firstAttrs = doc.querySelector('measure attributes');
  if (firstAttrs) {
    const fifths = parseInt(firstAttrs.querySelector('fifths')?.textContent ?? '0', 10);
    if (!isNaN(fifths) && fifths >= -7 && fifths <= 7) globalKeyFifths = fifths;

    const beats = parseInt(firstAttrs.querySelector('time beats')?.textContent ?? '4', 10);
    const beatType = parseInt(firstAttrs.querySelector('time beat-type')?.textContent ?? '4', 10);
    if (isValidTimeSignature([beats, beatType])) globalTimeSig = [beats, beatType];

    const clefSign = firstAttrs.querySelector('clef sign')?.textContent ?? 'G';
    const clefLine = firstAttrs.querySelector('clef line')?.textContent;
    defaultClef = xmlClefToClefType(clefSign, clefLine);
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
    let clef: ClefType = defaultClef;
    if (firstPartAttrs) {
      const sign = firstPartAttrs.querySelector('clef sign')?.textContent ?? 'G';
      const line = firstPartAttrs.querySelector('clef line')?.textContent;
      clef = xmlClefToClefType(sign, line);
    }

    const measureEls = Array.from(partEl.querySelectorAll('measure'));
    // 松葉（ヘアピン）は小節をまたぐ場合があるため、パート全体で1つの待ち行列を使い回す。
    // 声部1と声部2で別々に持つのは、<backup> を挟んで別々の松葉が同時に開くことがあるため。
    const openHairpinRefs: HairpinMark[] = [];
    const openHairpinRefsVoice2: HairpinMark[] = [];
    const measures: MeasureData[] = measureEls.map((measureEl, mi) => {
      // 追加声部（下声など）は書出側が <backup> で区切って出力している。
      // #244 段5-5: 旧実装は最初の <backup> だけで2分割しており、3声以上の自己往復で
      // 声部3以降が声部2へ連結される（4声→2声へ潰れる）データ破壊があった。
      // さらに区間の順番だけで声部を決めると、空声部をスキップして書き出された疎なデータ
      // （声部2なし・声部3あり）や外部ソフト由来の XML で番号がずれる（Codex 2巡目 P1）。
      // <backup> は「時間の巻き戻し」であって声部番号ではないため、区間ごとの声部番号は
      // 各 note の <voice> タグから決める（タグの無い XML は従来どおり区間順で数える）。
      const allChildren = Array.from(measureEl.children);
      const rawSections: Element[][] = [[]];
      for (const el of allChildren) {
        if (el.tagName === 'backup') {
          rawSections.push([]);
        } else {
          rawSections[rawSections.length - 1].push(el);
        }
      }
      const sectionVoiceNumber = (children: Element[], fallback: number): number => {
        const firstNote = children.find((el) => el.tagName === 'note');
        const v = parseInt(firstNote?.querySelector('voice')?.textContent ?? '', 10);
        return !isNaN(v) && v >= 1 ? v : fallback;
      };
      const sectionsWithVoice = rawSections.map((children, si) => ({
        children,
        voiceNumber: sectionVoiceNumber(children, si + 1),
      }));
      const childrenForVoice = (n: number): Element[] =>
        sectionsWithVoice.filter((s) => s.voiceNumber === n).flatMap((s) => s.children);
      const voice1Children = childrenForVoice(1);
      const voice2Children = childrenForVoice(2);

      const voice1NoteEls = voice1Children.filter((el) => el.tagName === 'note');
      const events = parseNotes(voice1NoteEls);
      attachHairpinsToVoiceEvents(voice1Children, events, mi, openHairpinRefs);

      const voice2NoteEls = voice2Children.filter((el) => el.tagName === 'note');
      const voice2Events = voice2NoteEls.length > 0 ? parseNotes(voice2NoteEls) : [];
      // 声部2の松葉も同じ方式で復元する（voice2Events の要素を直接書き換える）
      attachHairpinsToVoiceEvents(voice2Children, voice2Events, mi, openHairpinRefsVoice2);

      // 声部3以降（松葉の復元は現行 UI が2声までなので行わない。「壊れず全声部が戻る」水準）。
      // 疎な番号（間の声部が空）は空の器で埋め、声部番号を保存データ上の位置と一致させる
      const noteBearingVoiceNumbers = sectionsWithVoice
        .filter((s) => s.children.some((el) => el.tagName === 'note'))
        .map((s) => s.voiceNumber);
      const maxVoiceNumber = noteBearingVoiceNumbers.length > 0 ? Math.max(...noteBearingVoiceNumbers) : 1;
      const extraVoiceEvents: NoteEvent[][] = [];
      for (let n = 3; n <= maxVoiceNumber; n++) {
        extraVoiceEvents.push(parseNotes(childrenForVoice(n).filter((el) => el.tagName === 'note')));
      }

      // リピート
      const leftBarline = measureEl.querySelector('barline[location="left"] repeat');
      const rightBarline = measureEl.querySelector('barline[location="right"] repeat');

      // 小節単位テンポ（sound/@tempo があれば取得）
      const soundEl = measureEl.querySelector('sound[tempo]');
      const bpm = soundEl ? parseInt(soundEl.getAttribute('tempo') ?? '', 10) : undefined;

      // リハーサルマーク（練習番号）: <direction-type><rehearsal> を拾う
      const rehearsalEl = measureEl.querySelector('direction-type rehearsal');
      const rehearsalText = rehearsalEl?.textContent?.trim();
      const rehearsalMark = rehearsalText && rehearsalText.length > 0 && rehearsalText.length <= 4
        ? rehearsalText
        : undefined;

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
        // 追加声部: 入力があった小節だけ voices を持たせる。
        // voiceMeasureUtils の withVoiceEventsUpdated と同じ形（声部2以降は既定で符幹下向き）に揃える。
        voices: (voice2Events.length > 0 || extraVoiceEvents.some((ve) => ve.length > 0))
          ? [
              { id: 'voice-1', events: events.length ? events : [{ dur: '1', isRest: true, keys: [] }] },
              { id: 'voice-2', events: voice2Events, stemDirection: 'down' as const },
              ...extraVoiceEvents.map((ve, i) => ({ id: `voice-${i + 3}`, events: ve, stemDirection: 'down' as const })),
            ]
          : undefined,
        repeatStart: leftBarline?.getAttribute('direction') === 'forward' ? true : undefined,
        repeatEnd: rightBarline?.getAttribute('direction') === 'backward' ? true : undefined,
        bpm: bpm && !isNaN(bpm) ? bpm : undefined,
        timeSignature: timeSig,
        keySignature: measureKeySig,
        rehearsalMark,
      };
    });

    return {
      partId: partName,
      clef,
      // 読込境界の実体化（#244 段5-4）: 単声部の小節は voices: undefined で組み立てられる
      // ため、ここで全小節へ voices[0] を実体化してから返す（他の読込境界と同じ扱い）
      measures: ensureMeasuresPrimaryVoiceMaterialized(
        measures.length ? measures : [{ events: [{ dur: '1', isRest: true, keys: [] }] }],
      ),
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
