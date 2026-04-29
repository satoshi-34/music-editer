import { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline, Beam, Accidental } from 'vexflow';
import type { Tool } from './Palette';
import { NotePlayer } from '../audio/NotePlayer';
import { SoundSource } from '../audio/SoundSource';
import { defaultAudioEngine } from '../audio/AudioEngine';

/* ============================================================
   ✅ 編集まとめ（初心者向けメモ）
   - クリック選択（“セル方式”）/ Delete削除 / Esc解除
   - ↑/↓ …… 線/間 1段で上下
   - Alt+↑/↓ … 半音で上下（#/b を自動付与）
   - Shift+↑/↓ … 1オクターブで上下
   - セル内クリックは距離で「選択 or 挿入」を自動判定
     ・選択半径 = min(10px, セル幅×0.25)
   - ガイド（横線&点）は小節rectと各セルrectのどちらに居ても出る
   ============================================================ */

type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';
type NoteEvent = { dur: DurKey; isRest: boolean; keys: string[] };
type MeasureData = { events: NoteEvent[] };

type Props = {
  systems?: number;
  gap?: number;
  measuresPerSystem?: number;
  tool: Tool;
  scale?: number;
  initialScoreData?: MeasureData[];
  onScoreDataChange?: (data: MeasureData[]) => void;
  startMeasureIndex?: number; // このStaffCanvasが担当する開始小節インデックス
  disabled?: boolean; // 編集を無効にするフラグ
  clef?: 'treble' | 'bass' | 'alto'; // 音部記号（デフォルト: treble）
  yOffset?: number; // Safari座標ズレ補正（client px単位）
};

/* ===== レイアウト/スペーシング ===== */
const TARGET_FILL = 0.99;
const PAGE_LEFT = 4, PAGE_RIGHT = 4;
const MIN_MEASURE_W = 52, LONG_HALF_MIN = 80, LONG_WHOLE_MIN = 92;
const BASE_PAD = 14, UNIT_WIDTH = 9, FLAG_EXTRA_PX = 4;
const CLEF_PAD_FIRST = 50, CLEF_PAD_OTHER = 28;
const EMPTY_MEASURE_UNITS = 0.6;
const BEATS_PER_MEASURE = 4;

/* ===== 範囲拡張（クリックしやすいよう五線の外にも余白） ===== */
const EXTRA_TOP_LINES = 6;
const EXTRA_BOTTOM_LINES = 10;

/* ===== ヒット領域パラメータ ===== */
const CELL_PAD = 6;
const HIT_MIN_W = 14;
const HIT_MIN_H_FACTOR = 2.2;
const SELECT_NEAR_PX = 10;      // 基準の「選択半径」
const SELECT_NEAR_FRAC = 0.25;  // セル幅に対する上限（25%）

/* ===== duration 変換 ===== */
type VFDur = 'w'|'h'|'q'|'8'|'16'|'32'|'64';
const toVFDur = (d: DurKey | string | undefined | null): VFDur =>
  d==='1'?'w':d==='2'?'h':d==='4'?'q':d==='8'?'8':d==='16'?'16':d==='32'?'32':d==='64'?'64':'q';
const beatsFromVF = (vf: VFDur) =>
  vf==='64'?1/16 : vf==='32'?1/8 : vf==='16'?1/4 : vf==='8'?1/2 : vf==='q'?1 : vf==='h'?2 : 4;
const vfToDenom = (vf: VFDur | string) =>
  vf==='64'?64 : vf==='32'?32 : vf==='16'?16 : vf==='8'?8 : vf==='q'?4 : vf==='h'?2 : 1;

/* ===== 幅配分 ===== */
const UNIT_BY_DENOM: Record<number, number> = { 1:1.45, 2:1.25, 4:1.00, 8:0.60, 16:0.50, 32:2.20, 64:2.60 };
function unitsForEvent(ev: NoteEvent): number {
  const d = vfToDenom(toVFDur(ev.dur));
  const flagExtra = d >= 16 ? (FLAG_EXTRA_PX / UNIT_WIDTH) : 0;
  return (UNIT_BY_DENOM[d] ?? 1) * (ev.isRest ? 0.85 : 1) + flagExtra;
}
function minContentWidth(m?: MeasureData): number {
  if (!m || !m.events?.length) return Math.max(MIN_MEASURE_W, BASE_PAD + UNIT_WIDTH * EMPTY_MEASURE_UNITS);
  let hasH=false, hasW=false;
  const units = m.events.reduce((s, ev) => {
    const dd = vfToDenom(toVFDur(ev.dur));
    if (dd===2) hasH = true; if (dd===1) hasW = true;
    return s + unitsForEvent(ev);
  }, 0);
  const raw = Math.max(MIN_MEASURE_W, BASE_PAD + UNIT_WIDTH * units);
  if (hasW) return Math.max(raw, LONG_WHOLE_MIN);
  if (hasH) return Math.max(raw, LONG_HALF_MIN);
  return raw;
}

/* ===== line ⇄ key（ト音記号。臨時記号は高さに無関係なので無視） ===== */
function lineToKeyTreble(line: number): string {
  const snapped = Math.round(line * 2) / 2;
  const stepsDown = Math.round(snapped * 2); // F5 を 0 として下に+0.5ずつ
  const letters = ['c','d','e','f','g','a','b'] as const;
  let idx = 3 - stepsDown, oct = 5;
  while (idx < 0) { idx += 7; oct -= 1; }
  while (idx >= 7) { idx -= 7; oct += 1; }
  return `${letters[idx]}/${oct}`;
}
function keyToLineTreble(key: string): number {
  const m = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if (!m) return 2;
  const letter = m[1].toLowerCase(), oct = +m[3];
  const idxMap: Record<string, number> = { c:0,d:1,e:2,f:3,g:4,a:5,b:6 };
  const target = oct * 7 + (idxMap[letter] ?? 0);
  const base = 5 * 7 + idxMap['f'];
  return (base - target) / 2;
}

/* ===== line ⇄ key（ヘ音記号。line 0 = A3 が最上線） ===== */
function lineToKeyBass(line: number): string {
  const snapped = Math.round(line * 2) / 2;
  const stepsDown = Math.round(snapped * 2); // A3 を 0 として下に +0.5 ずつ
  const letters = ['c','d','e','f','g','a','b'] as const;
  let idx = 5 - stepsDown, oct = 3; // A3: idx=5, oct=3
  while (idx < 0) { idx += 7; oct -= 1; }
  while (idx >= 7) { idx -= 7; oct += 1; }
  return `${letters[idx]}/${oct}`;
}
function keyToLineBass(key: string): number {
  const m = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if (!m) return 2;
  const letter = m[1].toLowerCase(), oct = +m[3];
  const idxMap: Record<string, number> = { c:0,d:1,e:2,f:3,g:4,a:5,b:6 };
  const target = oct * 7 + (idxMap[letter] ?? 0);
  const base = 3 * 7 + idxMap['a']; // A3
  return (base - target) / 2;
}

/* ===== line ⇄ key（アルト記号。line 0 = G4、line 2 = C4） ===== */
function lineToKeyAlto(line: number): string {
  const snapped = Math.round(line * 2) / 2;
  const stepsDown = Math.round(snapped * 2);
  const letters = ['c','d','e','f','g','a','b'] as const;
  let idx = 4 - stepsDown, oct = 4; // G4: idx=4
  while (idx < 0) { idx += 7; oct -= 1; }
  while (idx >= 7) { idx -= 7; oct += 1; }
  return `${letters[idx]}/${oct}`;
}
function keyToLineAlto(key: string): number {
  const m = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if (!m) return 2;
  const idxMap: Record<string, number> = { c:0,d:1,e:2,f:3,g:4,a:5,b:6 };
  const target = +m[3] * 7 + (idxMap[m[1].toLowerCase()] ?? 0);
  const base = 4 * 7 + idxMap['g']; // G4 = 32
  return (base - target) / 2;
}

/* ===== 半音移動：key ⇄ MIDI ===== */
const LETTER_TO_PC: Record<string, number> = { c:0, d:2, e:4, f:5, g:7, a:9, b:11 };
function keyToMidi(key: string): number | null {
  const m = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if (!m) return null;
  let pc = LETTER_TO_PC[m[1].toLowerCase()];
  if (m[2]==='#') pc += 1; else if (m[2]==='b') pc -= 1;
  pc = ((pc % 12) + 12) % 12;
  return 12 * (parseInt(m[3],10) + 1) + pc; // C4=60
}
function midiToKey(midi: number, preferSharp: boolean): string {
  const SHARP = ['c','c#','d','d#','e','f','f#','g','g#','a','a#','b'];
  const FLAT  = ['c','db','d','eb','e','f','gb','g','ab','a','bb','b'];
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  const name = preferSharp ? SHARP[pc] : FLAT[pc];
  return `${name}/${oct}`;
}

/* ===== SVGユーティリティ ===== */
/**
 * VexflowがレンダリングしたSVGのルートグループを取得する
 * @param svg SVG要素
 * @returns ルートグループ要素、または見つからない場合はnull
 */
function getVexflowGroup(svg: SVGSVGElement): SVGGElement | null {
  const groups = svg.querySelectorAll('g');
  return groups.length ? (groups[groups.length - 1] as SVGGElement) : null;
}

// CSS zoom の実効値を返す。
// SVG 要素では Safari で --scale が getComputedStyle に継承されないため、
// HTML 要素である .page-wrapper から読み取る。
function getAccumulatedCSSZoom(el: Element): number {
  const wrapper = el.closest('.page-wrapper');
  if (wrapper) {
    const v = parseFloat(window.getComputedStyle(wrapper).getPropertyValue('--scale').trim());
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 1;
}

// client座標 → SVG viewBox 座標
// Safari 旧版では getBoundingClientRect() が CSS zoom を反映しないため、
// サイズと位置の両方を補正して正確な座標を返す。
function clientToGroup(
  svg: SVGSVGElement,
  _group: SVGGElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const svgRect = svg.getBoundingClientRect();
  if (!svgRect.width || !svgRect.height) return { x: 0, y: 0 };

  const viewBox = svg.viewBox?.baseVal;
  const vbW = (viewBox && viewBox.width > 0) ? viewBox.width : svg.width.baseVal.value;
  const vbH = (viewBox && viewBox.height > 0) ? viewBox.height : svg.height.baseVal.value;
  const logW = svg.width.baseVal.value;
  const logH = svg.height.baseVal.value;

  const cssZoom = getAccumulatedCSSZoom(svg);

  // Chrome: BCR は CSS zoom 込みの視覚サイズ/位置を返す → svgRect.width ≒ logW * cssZoom
  // Safari 旧版: CSS zoom を反映しない論理サイズ/位置を返す → svgRect.width ≒ logW
  const expectedVisualW = logW * cssZoom;
  const bcrReflectsZoom = Math.abs(svgRect.width - expectedVisualW) < logW * 0.05;
  const visualW = bcrReflectsZoom ? svgRect.width : expectedVisualW;
  const visualH = bcrReflectsZoom ? svgRect.height : logH * cssZoom;

  // Safari は left/top も論理座標だが clientX/Y は視覚座標。
  // .page-wrapper が zoom: var(--scale) の適用点。その BCR.left は zoom 境界の視覚座標として正確。
  // SVG の論理オフセットに cssZoom を掛けて視覚 origin を求める。
  let originLeft = svgRect.left;
  let originTop  = svgRect.top;
  if (!bcrReflectsZoom) {
    const zoomContainer = svg.closest('.page-wrapper');
    if (zoomContainer) {
      const cr = zoomContainer.getBoundingClientRect();
      originLeft = cr.left + (svgRect.left - cr.left) * cssZoom;
      originTop  = cr.top  + (svgRect.top  - cr.top)  * cssZoom;
    }
  }

  const x = (clientX - originLeft) * (vbW / visualW);
  const y = (clientY - originTop)  * (vbH / visualH);

  if (!isFinite(x) || !isFinite(y)) return { x: 0, y: 0 };
  return { x, y };
}

/* ===== 行間スナップ ===== */
/**
 * Y座標を最も近い五線の線または間にスナップする
 * getSpacingBetweenLines()を使用して正確な行間隔を取得し、
 * 0.5行刻みで最も近い位置にスナップする
 * 
 * @param stave Vexflowの五線オブジェクト
 * @param y スナップ対象のY座標（SVG座標系）
 * @returns スナップされた線番号（0.5刻み、加線域を含む）
 */
function snapLineBySpacing(stave: Stave, y: number): number {
  // 五線の最上部（第1線）のY座標を取得
  const topY = stave.getYForLine(0);
  
  // getSpacingBetweenLines()で正確な行間隔を取得
  // フォールバック：第1線と第5線の間隔から計算
  const spacing = (stave.getSpacingBetweenLines?.() as number) || ((stave.getYForLine(4) - topY) / 4);
  
  // 加線域を含む範囲を設定
  const minLine = -EXTRA_TOP_LINES;
  const maxLine = 4 + EXTRA_BOTTOM_LINES;
  
  // 最も近い線を探索（0.5行刻み）
  let bestLine = 0;
  let minDiff = Infinity;
  
  for (let line = minLine; line <= maxLine; line += 0.5) {
    const yCandidate = topY + line * spacing;
    const diff = Math.abs(y - yCandidate);
    
    if (diff < minDiff) {
      minDiff = diff;
      bestLine = Math.round(line * 2) / 2; // 0.5刻みで正確に丸める
    }
  }
  
  return bestLine;
}

/* ===== 時間ベース位置計算（休符重なり修正用） ===== */

/* ===== ノート生成（臨時記号を付与） ===== */
function makeVFNote(ev: NoteEvent, clef: 'treble' | 'bass' | 'alto' = 'treble') {
  const vfDur = toVFDur(ev.dur);
  if (ev.isRest) {
    const restKey = clef === 'bass' ? 'd/3' : clef === 'alto' ? 'c/4' : 'b/4';
    const n = new StaveNote({ clef, keys: [restKey], duration: (vfDur as VFDur) + 'r' });
    return n;
  }
  // keys が空の場合は全休符にフォールバック
  if (!ev.keys || ev.keys.length === 0) {
    const restKey = clef === 'bass' ? 'd/3' : clef === 'alto' ? 'c/4' : 'b/4';
    return new StaveNote({ clef, keys: [restKey], duration: (vfDur as VFDur) + 'r' });
  }
  const n = new StaveNote({ clef, keys: ev.keys, duration: vfDur });
  // 各音高に臨時記号を付与
  ev.keys.forEach((key, idx) => {
    const m = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i);
    const acc = m?.[2] || '';
    if (acc) {
      try { (n as any).addModifier?.(idx, new Accidental(acc)); (n as any).addAccidental?.(idx, new Accidental(acc)); } catch {}
    }
  });
  return n;
}

/* ===== 範囲チェック（要件3.4対応） ===== */
/**
 * 小節インデックスが有効な範囲内かチェックする
 * @param measureIndex チェック対象の小節インデックス
 * @param totalMeasures 総小節数
 * @returns 有効な範囲内の場合はtrue
 */
function isValidMeasureIndex(measureIndex: number, totalMeasures: number): boolean {
  if (measureIndex < 0 || measureIndex >= totalMeasures) {
    console.error(`[範囲エラー] 小節インデックス ${measureIndex} は範囲外です（有効範囲: 0-${totalMeasures - 1}）`);
    return false;
  }
  return true;
}

/* ===== デバッグログ（要件4.1, 4.2対応） ===== */
/**
 * 音符追加時のデバッグ情報をログ出力する
 * @param measureIndex 小節インデックス
 * @param x X座標
 * @param y Y座標
 * @param key 音高キー
 */
function logNoteAddition(measureIndex: number, x: number, y: number, key: string): void {
  console.log(`[音符追加] 小節=${measureIndex}, 座標=(${x.toFixed(1)}, ${y.toFixed(1)}), 音高=${key}`);
}

export default function StaffCanvas({
  systems = 6, gap = 110, measuresPerSystem = 4, tool, scale = 0.86,
  initialScoreData, onScoreDataChange, startMeasureIndex = 0, disabled = false,
  clef = 'treble', yOffset = 0,
}: Props) {
  // clef に応じた変換関数を選択
  const lineToKey = clef === 'bass' ? lineToKeyBass : clef === 'alto' ? lineToKeyAlto : lineToKeyTreble;
  const keyToLine = clef === 'bass' ? keyToLineBass : clef === 'alto' ? keyToLineAlto : keyToLineTreble;
  const ref = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState<MeasureData[]>(() => {
    // initialScoreDataが提供されている場合はそれを使用
    if (initialScoreData && initialScoreData.length > 0) {
      return initialScoreData;
    }
    // それ以外の場合は、このStaffCanvasが必要とする範囲の空の小節を作成
    const totalMeasures = startMeasureIndex + systems * measuresPerSystem;
    return Array.from({ length: totalMeasures }, () => ({ events: [] }));
  });
  const [selected, setSelected] = useState<{ measure: number; index: number } | null>(null);
  const selectedRef = useRef(selected);
  const disabledRef = useRef(disabled);
  const yOffsetRef = useRef(yOffset);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { yOffsetRef.current = yOffset; }, [yOffset]);

  // NotePlayerインスタンスの管理
  const notePlayerRef = useRef<NotePlayer | null>(null);
  const soundSourceRef = useRef<SoundSource | null>(null);
  
  // NotePlayerの初期化
  useEffect(() => {
    const initializeNotePlayer = async () => {
      try {
        // AudioEngineの初期化を試行（ユーザーインタラクション前は失敗する可能性がある）
        if (!defaultAudioEngine.isInitializedState()) {
          console.log('[StaffCanvas] AudioEngineの初期化を試行中...');
          try {
            await defaultAudioEngine.initialize();
          } catch (error) {
            console.log('[StaffCanvas] AudioEngineの初期化は後で行われます:', error);
          }
        }
        
        // SoundSourceを作成
        soundSourceRef.current = new SoundSource(defaultAudioEngine);
        
        // デフォルト楽器を読み込み
        await soundSourceRef.current.loadInstrument(soundSourceRef.current.getCurrentInstrument());
        
        // NotePlayerを作成
        notePlayerRef.current = new NotePlayer(defaultAudioEngine, soundSourceRef.current);
        console.log('[StaffCanvas] NotePlayerが初期化されました');
      } catch (error) {
        console.error('[StaffCanvas] NotePlayerの初期化に失敗:', error);
      }
    };
    
    initializeNotePlayer();
    
    // クリーンアップ
    return () => {
      if (notePlayerRef.current) {
        notePlayerRef.current.dispose();
        notePlayerRef.current = null;
      }
      if (soundSourceRef.current) {
        soundSourceRef.current.dispose();
        soundSourceRef.current = null;
      }
    };
  }, []);
  
  // 音符再生関数
  const playNoteEvent = async (noteEvent: NoteEvent) => {
    if (!notePlayerRef.current) {
      console.warn('[StaffCanvas] NotePlayerが初期化されていません');
      return;
    }
    
    try {
      // AudioContextをユーザーインタラクション時に開始
      console.log('[StaffCanvas] AudioContextを開始中...');
      if (!defaultAudioEngine.isInitializedState()) {
        await defaultAudioEngine.initialize();
      }
      await defaultAudioEngine.start();
      
      // AudioContextが作成された後、シンセサイザーを再接続
      if (soundSourceRef.current) {
        soundSourceRef.current.reconnectAllSynths();
      }
      
      console.log('[StaffCanvas] AudioContext開始完了');
      
      // 音符を再生（連続クリック時の前音停止処理は NotePlayer 内で実行される）
      await notePlayerRef.current.playNoteEvent(noteEvent);
      console.log(`[StaffCanvas] 音符を再生: ${noteEvent.keys.join(',')}, 音価: ${noteEvent.dur}, 休符: ${noteEvent.isRest}`);
    } catch (error) {
      console.error('[StaffCanvas] 音符再生に失敗:', error);
      
      // ユーザーに分かりやすいエラーメッセージを表示
      if (error instanceof Error && error.message.includes('user gesture')) {
        console.warn('[StaffCanvas] 音符をクリックして音声を有効化してください');
      }
    }
  };

  // Update score when initialScoreData changes (when loading data)
  useEffect(() => {
    if (initialScoreData && initialScoreData.length > 0) {
      // initialScoreDataが提供されている場合、それを使用
      // ただし、このStaffCanvasが必要とする範囲を確保
      const requiredLength = startMeasureIndex + systems * measuresPerSystem;
      if (initialScoreData.length < requiredLength) {
        // 不足分を空の小節で埋める
        const extended = [...initialScoreData];
        while (extended.length < requiredLength) {
          extended.push({ events: [] });
        }
        setScore(extended);
      } else {
        setScore(initialScoreData);
      }
      setSelected(null); // Clear selection when loading new data
    }
  }, [initialScoreData, startMeasureIndex, systems, measuresPerSystem]);

  // Call callback when score data changes
  const prevScoreRef = useRef<MeasureData[]>([]);
  const isFirstRender = useRef(true);
  
  useEffect(() => {
    // 初回レンダリング時はコールバックを呼び出さない
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevScoreRef.current = score;
      return;
    }
    
    // 前回の値と異なる場合のみコールバックを呼び出す
    if (onScoreDataChange && JSON.stringify(prevScoreRef.current) !== JSON.stringify(score)) {
      onScoreDataChange(score);
      prevScoreRef.current = score;
    }
  }, [score]); // onScoreDataChangeを依存配列から除外して無限ループを防ぐ


  /* ===== キー操作（削除/上下移動/解除） ===== */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const selected = selectedRef.current;
      if (!selected || disabledRef.current) return;
      const { measure, index } = selected;
      const inRange = (arr: any[], i: number) => i >= 0 && i < arr.length;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        setScore(prev => {
          if (!inRange(prev, measure)) return prev;
          const next = prev.map(m => ({ events: [...m.events] }));
          if (!inRange(next[measure].events, index)) return prev;
          next[measure].events.splice(index, 1);
          return next;
        });
        setSelected(null);
        e.preventDefault(); return;
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const up = e.key === 'ArrowUp';
        setScore(prev => {
          if (!inRange(prev, measure)) return prev;
          const cur = prev[measure];
          if (!inRange(cur.events, index)) return prev;
          const ev = cur.events[index];
          if (ev.isRest) return prev;

          if (e.altKey) { // 半音（和音の場合は全音を同じだけシフト）
            const delta = up ? 1 : -1;
            const newKeys = ev.keys.map(k => {
              const midi = keyToMidi(k); if (midi == null) return k;
              return midiToKey(midi + delta, up);
            });
            const next = prev.map(m => ({ events: [...m.events] as NoteEvent[] }));
            next[measure].events[index] = { ...ev, keys: newKeys };
            return next;
          }

          if (e.shiftKey) { // 1オクターブ（和音の場合は全音を同じだけシフト）
            const diff = up ? -3.5 : 3.5;
            const newKeys = ev.keys.map(k => lineToKey(keyToLine(k) + diff));
            const next = prev.map(m => ({ events: [...m.events] as NoteEvent[] }));
            next[measure].events[index] = { ...ev, keys: newKeys };
            return next;
          }

          // 線/間 1段（和音の場合は全音を同じだけシフト）
          const diff = up ? -0.5 : 0.5;
          const newKeys = ev.keys.map(k => lineToKey(keyToLine(k) + diff));
          const next = prev.map(m => ({ events: [...m.events] as NoteEvent[] }));
          next[measure].events[index] = { ...ev, keys: newKeys };
          return next;
        });
        e.preventDefault(); return;
      }

      if (e.key === 'Escape') { setSelected(null); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // refを使うため依存不要、マウント時に1度だけ登録

  /* ======================== 描画 ======================== */
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';

    const W = ref.current.parentElement?.clientWidth ?? ref.current.clientWidth ?? 700;
    const top = 10, bottom = 30, H = top + systems * gap + bottom;

    const renderer = new Renderer(ref.current, Renderer.Backends.SVG);
    renderer.resize(W, H);
    const ctx = renderer.getContext();

    const svg = ref.current.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;

    // SVGのデフォルトはdisplay:inlineのため、親divの高さが正しく展開されない。
    // display:blockにすることで親divがSVGの高さ分だけ正しく広がり、
    // PianoStaffで2つのStaffCanvasを縦に並べたとき重ならなくなる。
    svg.style.display = 'block';

    // 🛠️ ここで一度だけ root グループを取得して、以降は使い回す
    const svgRoot = (getVexflowGroup(svg) as SVGGElement | null) || svg;

    const s = Math.max(0.75, Math.min(1.0, scale ?? 1));
    ctx.scale(s, s);

    const innerW = W - PAGE_LEFT - PAGE_RIGHT;
    const left = PAGE_LEFT;

    let globalIndex = 0;
    const maxMeasures = systems * measuresPerSystem; // このStaffCanvasが描画する最大小節数

    for (let line = 0; line < systems; line++) {
      if (globalIndex >= maxMeasures) break; // このStaffCanvasの範囲を超えたら終了
      const absoluteStartIndex = startMeasureIndex + globalIndex;
      if (absoluteStartIndex >= score.length) break; // 全体のスコアを超えたら終了

      const y = top + line * gap;
      const CLEF_PAD_THIS = (line === 0) ? CLEF_PAD_FIRST : CLEF_PAD_OTHER;

      // 何小節入れるか試す
      const candidates = [measuresPerSystem, 3, 2, 1].filter((v,i,a)=>a.indexOf(v)===i);
      let chosen = 1, widths: number[] = [], startX = left;

      const tryFit = (n: number) => {
        const last = Math.min(globalIndex + n, score.length);
        const items = score.slice(globalIndex, last).map((_, idx) => {
          const absoluteIdx = startMeasureIndex + globalIndex + idx;
          return absoluteIdx < score.length ? score[absoluteIdx] : undefined;
        });
        let occupy = innerW * TARGET_FILL; if (n === 1) occupy = innerW;

        const alloc = Math.max(0, occupy - CLEF_PAD_THIS);
        const minWs = items.map(minContentWidth); while (minWs.length < n) minWs.push(MIN_MEASURE_W);
        const weights = items.map(m => m?.events?.length
          ? m.events.reduce((u, ev) => u + unitsForEvent(ev), 0)
          : EMPTY_MEASURE_UNITS);
        while (weights.length < n) weights.push(EMPTY_MEASURE_UNITS);

        const sumMin = minWs.reduce((a,b)=>a+b,0); if (sumMin > alloc * 1.002) return null;
        const extra = Math.max(0, alloc - sumMin);
        const wsum = weights.reduce((a,b)=>a+b,0) || 1;
        const content = minWs.map((w,i)=> w + extra * (weights[i]/wsum));
        const real = content.map((w,i)=> i===0 ? w + CLEF_PAD_THIS : w);
        const need = real.reduce((a,b)=>a+b,0);
        const start = left + (innerW - occupy) / 2;
        if (need > occupy * 1.002 && n > 1) return null;
        return { widths: real, startX: start };
      };

      let fitted: null | { widths: number[]; startX: number } = null;
      for (const n of candidates) { fitted = tryFit(n); if (fitted){ chosen=n; widths=fitted.widths; startX=fitted.startX; break; } }
      if (!fitted) { chosen = 1; widths = [innerW]; startX = left; }

      let x = startX;

      for (let i = 0; i < chosen && globalIndex < maxMeasures; i++, globalIndex++) {
        const absoluteIndex = startMeasureIndex + globalIndex; // 絶対インデックスを計算
        if (absoluteIndex >= score.length) break; // 全体のスコアを超えたら終了
        
        const w = widths[i];
        const data: MeasureData | undefined = score[absoluteIndex];

        const stave = new Stave(x / s, y / s, w / s);
        if (i === 0) { stave.addClef(clef); if (line === 0) stave.addTimeSignature('4/4'); }
        stave.setEndBarType(Barline.type.SINGLE);
        stave.setContext(ctx).draw();

        const safeEvents: NoteEvent[] =
          (data && data.events && data.events.length > 0 ? data.events : [{ dur:'1', isRest:true, keys:['b/4'] }])
          .map(ev => (!ev || !ev.dur ? { dur:'4' as DurKey, isRest:true, keys:['b/4'] } : {
            ...ev,
            dur: ev.dur as DurKey
          }));

        const vfNotes: StaveNote[] = safeEvents.map((ev, idx) => {
          const n = makeVFNote(ev, clef) as any;
          const isSel = !!selected && selected.measure === absoluteIndex && selected.index === idx;
          if (isSel && n.setStyle) n.setStyle({ fillStyle:'#1d4ed8', strokeStyle:'#1d4ed8' });
          return n as StaveNote;
        });

        const beams = Beam.generateBeams(vfNotes, { beamRests: false });
        const voice = new Voice({ time: { num_beats: BEATS_PER_MEASURE, beat_value: 4 } } as any);
        voice.setMode((Voice as any).Mode.SOFT ?? 1);
        voice.addTickables(vfNotes);
        new Formatter().joinVoices([voice]).formatToStave([voice], stave);
        
        const measureIndex = globalIndex; // 相対インデックス（このStaffCanvas内での位置）
        const xDraw = x / s, wDraw = w / s;
        const measLeft = xDraw, measRight = xDraw + wDraw;

        // 休符位置調整（Formatter実行後、voice.draw前に実行）
        // 全休符の場合は小節の中央に配置
        try {
          // 音部記号の有無を判定（各行の最初の小節にのみ音部記号がある）
          const hasClef = (i === 0);
          
          // 簡単な全休符中央配置
          for (let j = 0; j < vfNotes.length && j < safeEvents.length; j++) {
            const note = vfNotes[j];
            const event = safeEvents[j];
            
            if (event.isRest && event.dur === '1') { // 全休符の場合
              try {
                // stave.getNoteStartX()で実際のノート描画開始位置を取得（クレフ・拍子記号を正確に考慮）
                const noteStartX = typeof (stave as any).getNoteStartX === 'function'
                  ? (stave as any).getNoteStartX()
                  : xDraw + (hasClef ? 50 : 0);
                const staveEndX = xDraw + wDraw;
                const centerX = (noteStartX + staveEndX) / 2;

                // 現在の位置を取得（getAbsoluteXはxShiftを含まない）
                const currentX = (note as any).getAbsoluteX?.() || noteStartX;
                const offset = centerX - currentX;
                
                // 位置を調整
                if (Math.abs(offset) > 1 && typeof (note as any).setXShift === 'function') {
                  (note as any).setXShift(offset);
                }
              } catch (adjustError) {
                console.warn(`小節 ${absoluteIndex}: 全休符位置調整に失敗`, adjustError);
              }
            }
          }
        } catch (adjustError) {
          console.error('休符位置調整でエラーが発生しました:', adjustError);
          // フォールバック: 調整なしで描画を続行
        }
        
        try {
          voice.draw(ctx, stave);
        } catch (drawError) {
          console.error('voice描画でエラーが発生しました:', drawError);
          // フォールバック: ビームのみ描画を試行
        }
        beams.forEach(b => b.setContext(ctx).draw());

        /* --- ガイド更新/非表示（小節rect/セルrect 両方から呼ぶ） --- */
        const guideLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        guideLine.setAttribute('class', 'vf-guide-line');
        guideLine.style.display = 'none';
        guideLine.setAttribute('pointer-events', 'none');
        guideLine.setAttribute('x1', String(measLeft));
        guideLine.setAttribute('x2', String(measRight));
        guideLine.setAttribute('y1', '0');
        guideLine.setAttribute('y2', '0');

        const guideDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        guideDot.setAttribute('class', 'vf-guide-dot');
        guideDot.style.display = 'none';
        guideDot.setAttribute('pointer-events', 'none');
        guideDot.setAttribute('r', '2.8');

        const updateGuide = (localX: number, localY: number) => {
          // Y座標をスナップして音高を決定
          const snapped = snapLineBySpacing(stave, localY);
          const yGuide = stave.getYForLine(snapped);
          
          // ガイドラインのX座標を小節の範囲内に制限
          const clampedX = Math.max(measLeft, Math.min(localX, measRight));
          
          // ガイドラインの位置を更新（小節の範囲内のみ）
          guideLine.setAttribute('x1', String(measLeft));
          guideLine.setAttribute('x2', String(measRight));
          guideLine.setAttribute('y1', String(yGuide));
          guideLine.setAttribute('y2', String(yGuide));
          guideLine.style.display = 'block';
          
          // ガイドドットの位置を更新（小節の範囲内のみ）
          guideDot.setAttribute('cx', String(clampedX));
          guideDot.setAttribute('cy', String(yGuide));
          guideDot.style.display = 'block';
        };
        const hideGuide = () => {
          guideLine.style.display = 'none';
          guideDot.style.display = 'none';
        };

        /* --- 挿入処理（クリック座標→どこに挿入するか決めて追加） --- */
        const doInsertAt = (localX: number, localY: number, targetMeasureIndex: number) => {
          // 相対インデックスを絶対インデックスに変換
          const absoluteMeasureIndex = startMeasureIndex + targetMeasureIndex;
          
          // 範囲チェック（要件3.4対応）
          if (!isValidMeasureIndex(absoluteMeasureIndex, score.length)) {
            return;
          }
          
          const snappedLine = snapLineBySpacing(stave, localY);
          const key = lineToKey(snappedLine);

          let insertAt = safeEvents.length;
          let minDist = Infinity;

          if (vfNotes.length > 0) {
            const dL = Math.abs(localX - measLeft); if (dL < minDist) { minDist = dL; insertAt = 0; }
            const dR = Math.abs(localX - measRight); if (dR < minDist) { minDist = dR; insertAt = vfNotes.length; }

            const fallbackNoteWidth = Math.max(20, wDraw / (vfNotes.length + 1));
            for (let j = 0; j < vfNotes.length; j++) {
              const n: any = vfNotes[j];
              const leftX = n.getAbsoluteX ? n.getAbsoluteX() : (measLeft + (j + 1) * (wDraw / (vfNotes.length + 1)));
              const bb = n.getBoundingBox?.();
              const width = bb ? bb.getW() : fallbackNoteWidth;
              const rightX = leftX + width;

              if (localX >= leftX && localX <= rightX) {
                insertAt = (localX < (leftX + rightX) / 2) ? j : (j + 1);
                minDist = 0; break;
              }
              if (localX < leftX) { const d = leftX - localX; if (d < minDist) { minDist = d; insertAt = j; } }
              if (localX > rightX) { const d = localX - rightX; if (d < minDist) { minDist = d; insertAt = j + 1; } }
            }
          }
          
          // デバッグログ（要件4.1, 4.2対応）
          logNoteAddition(absoluteMeasureIndex, localX, localY, key);

          setScore(prev => {
            const next = prev.map(m => ({ events: [...(m?.events ?? [])] as NoteEvent[] }));
            while (absoluteMeasureIndex >= next.length) next.push({ events: [] });
            const m = next[absoluteMeasureIndex];

            const vfDur = toVFDur((tool as any)?.duration);
            const addBeats = beatsFromVF(vfDur);
            const curBeats = m.events.reduce((s2, ev) => s2 + beatsFromVF(toVFDur(ev.dur)), 0);
            if (curBeats + addBeats > BEATS_PER_MEASURE) return prev;

            const ev: NoteEvent = {
              dur: (['1','2','4','8','16','32','64'].includes((tool as any)?.duration) ? (tool as any).duration : '4') as DurKey,
              isRest: !!(tool as any)?.isRest,
              keys: [key],
            };
            m.events.splice(Math.max(0, Math.min(insertAt, m.events.length)), 0, ev);
            return next;
          });
        };

        /* --- 小節全体：挿入用透明rect + ガイド --- */
        const rectTop = stave.getYForLine(-EXTRA_TOP_LINES);
        const rectBottom = stave.getYForLine(4 + EXTRA_BOTTOM_LINES);
        const insertRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        insertRect.setAttribute('class', 'vf-hit');
        insertRect.setAttribute('data-measure-index', String(absoluteIndex));
        insertRect.setAttribute('x', String(measLeft));
        insertRect.setAttribute('y', String(rectTop));
        insertRect.setAttribute('width', String(wDraw));
        insertRect.setAttribute('height', String(rectBottom - rectTop));
        insertRect.setAttribute('fill', 'transparent');
        insertRect.setAttribute('stroke', 'none');
        insertRect.setAttribute('pointer-events', 'all');
        (insertRect.style as any).cursor = 'crosshair';

        (svgRoot as any).appendChild(guideLine);
        (svgRoot as any).appendChild(guideDot);
        (svgRoot as any).appendChild(insertRect);

        insertRect.addEventListener('mousemove', (e) => {
          const { x: lx, y: ly } = clientToGroup(svg, svgRoot as SVGGElement, e.clientX, e.clientY + yOffsetRef.current);
          
          // マウスが小節の範囲内（X座標とY座標の両方）にある場合のみガイドを表示
          if (lx >= measLeft && lx <= measRight && ly >= rectTop && ly <= rectBottom) {
            updateGuide(lx, ly);
          } else {
            hideGuide();
          }
        });
        insertRect.addEventListener('mouseleave', hideGuide);
        insertRect.addEventListener('click', (e) => {
          // 編集が無効な場合は何もしない
          if (disabled) {
            return;
          }
          
          const { x: lx, y: ly } = clientToGroup(svg, svgRoot as SVGGElement, e.clientX, e.clientY + yOffsetRef.current);
          
          // doInsertAt関数を使用して音符を挿入
          doInsertAt(lx, ly, measureIndex);
        });

        /* --- セル方式（選択とガイド、そして分岐クリック） --- */
        if (vfNotes.length > 0) {
          const anchors: number[] = vfNotes.map((n: any, j: number) =>
            n.getAbsoluteX ? n.getAbsoluteX() : (measLeft + (j + 1) * (wDraw / (vfNotes.length + 1)))
          );
          const mids: number[] = [];
          for (let j = 0; j < anchors.length - 1; j++) mids.push((anchors[j] + anchors[j + 1]) / 2);

          vfNotes.forEach((n: any, j: number) => {
            const rawLeft  = (j === 0) ? measLeft : mids[j - 1];
            const rawRight = (j === vfNotes.length - 1) ? measRight : mids[j];

            let xLeft  = Math.max(measLeft + 1, rawLeft  - CELL_PAD);
            let xRight = Math.min(measRight - 1, rawRight + CELL_PAD);
            if (xRight - xLeft < HIT_MIN_W) {
              const need = HIT_MIN_W - (xRight - xLeft), half = need / 2;
              xLeft = Math.max(measLeft + 1, xLeft - half);
              xRight = Math.min(measRight - 1, xRight + half);
              if (xRight - xLeft < HIT_MIN_W) xLeft = Math.max(measLeft + 1, xRight - HIT_MIN_W);
            }
            const wHit = Math.max(HIT_MIN_W, xRight - xLeft);
            const xHit = xLeft;

            const bb = n.getBoundingBox?.();
            const spacing = (stave.getSpacingBetweenLines?.() as number) || ((stave.getYForLine(4) - stave.getYForLine(0)) / 4);
            const evData = safeEvents[j];
            const yCenter = evData?.isRest ? stave.getYForLine(2) : stave.getYForLine(keyToLine(evData.keys[0]));
            const safeH = Math.max(bb?.getH?.() ?? 26, spacing * HIT_MIN_H_FACTOR);
            const yHit = yCenter - safeH / 2;

            const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            hit.setAttribute('class', 'vf-note-hit');
            hit.setAttribute('x', String(xHit));
            hit.setAttribute('y', String(yHit));
            hit.setAttribute('width', String(wHit));
            hit.setAttribute('height', String(safeH));
            hit.setAttribute('fill', 'transparent');
            hit.setAttribute('stroke', 'none');
            hit.setAttribute('pointer-events', 'all');
            (hit.style as any).cursor = 'pointer';

            // セル上でもガイドを出す
            hit.addEventListener('mousemove', (ev) => {
              const { x: lx, y: ly } = clientToGroup(svg, svgRoot as SVGGElement, ev.clientX, ev.clientY + yOffsetRef.current);
              
              // マウスが小節の範囲内にある場合のみガイドを表示
              if (lx >= measLeft && lx <= measRight) {
                updateGuide(lx, ly);
              } else {
                hideGuide();
              }
            });
            hit.addEventListener('mouseenter', (ev) => {
              const { x: lx, y: ly } = clientToGroup(svg, svgRoot as SVGGElement, ev.clientX, ev.clientY + yOffsetRef.current);
              
              // マウスが小節の範囲内にある場合のみガイドを表示
              if (lx >= measLeft && lx <= measRight) {
                updateGuide(lx, ly);
              } else {
                hideGuide();
              }
            });
            hit.addEventListener('mouseleave', hideGuide);

            // クリック：Shift+クリックで和音追加、近ければ選択、離れていれば挿入
            hit.addEventListener('click', (ev) => {
              if (disabled) return;
              ev.stopPropagation(); // 小節rectには渡さない
              const { x: lx, y: ly } = clientToGroup(svg, svgRoot as SVGGElement, ev.clientX, ev.clientY + yOffsetRef.current);

              if (ev.shiftKey && !safeEvents[j]?.isRest) {
                // Shift+クリック: 既存の音符に音を追加して和音にする
                // 同じ音が既にあれば無視し、なければ音高の低い順（line値大＝低音）にソートして追加
                const snappedLine = snapLineBySpacing(stave, ly);
                const newKey = lineToKey(snappedLine);
                setScore(prev => {
                  const next = prev.map(m => ({ events: [...(m?.events ?? [])] as NoteEvent[] }));
                  if (absoluteIndex >= next.length) return prev;
                  const targetEv = next[absoluteIndex].events[j];
                  if (!targetEv || targetEv.isRest || targetEv.keys.includes(newKey)) return prev;
                  const newKeys = [...targetEv.keys, newKey].sort((a, b) => keyToLine(b) - keyToLine(a));
                  next[absoluteIndex].events[j] = { ...targetEv, keys: newKeys };
                  return next;
                });
              } else {
                const cellW = rawRight - rawLeft;
                const selRadius = Math.min(SELECT_NEAR_PX, Math.max(0, cellW * SELECT_NEAR_FRAC));
                const dx = Math.abs(lx - anchors[j]);
                if (dx <= selRadius) {
                  setSelected({ measure: startMeasureIndex + measureIndex, index: j });
                  const noteEvent = safeEvents[j];
                  if (noteEvent) playNoteEvent(noteEvent);
                } else {
                  doInsertAt(lx, ly, measureIndex);
                }
              }
            });

            (svgRoot as any).appendChild(hit);

            const isSel = !!selected && selected.measure === absoluteIndex && selected.index === j;
            if (isSel) {
              const sel = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
              sel.setAttribute('class', 'vf-note-selected');
              sel.setAttribute('x', String(xHit - 3));
              sel.setAttribute('y', String(yHit - 3));
              sel.setAttribute('width', String(wHit + 6));
              sel.setAttribute('height', String(safeH + 6));
              sel.setAttribute('rx', '4'); sel.setAttribute('ry', '4');
              (svgRoot as any).appendChild(sel);
            }
          });
        }

        x += w;
      }
    }
  }, [systems, gap, measuresPerSystem, score, tool, scale, selected]);

  return <div ref={ref} />;
}