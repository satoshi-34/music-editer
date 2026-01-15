import { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline, Beam, Accidental } from 'vexflow';
import type { Tool } from './Palette';

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
type NoteEvent = { dur: DurKey; isRest: boolean; key: string };
type MeasureData = { events: NoteEvent[] };

type Props = {
  systems?: number;
  gap?: number;
  measuresPerSystem?: number;
  tool: Tool;
  scale?: number;
  initialScoreData?: MeasureData[];
  onScoreDataChange?: (data: MeasureData[]) => void;
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
function getVexflowGroup(svg: SVGSVGElement): SVGGElement | null {
  const groups = svg.querySelectorAll('g');
  return groups.length ? (groups[groups.length - 1] as SVGGElement) : null;
}

function clientToGroup(svg: SVGSVGElement, group: SVGGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; 
  pt.y = clientY;
  const m = (group as any).getScreenCTM?.();
  if (!m) return { x: 0, y: 0 };
  const p = pt.matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

/* ===== 行間スナップ ===== */
function snapLineBySpacing(stave: Stave, y: number): number {
  const topY = stave.getYForLine(0);
  const sp = (stave.getSpacingBetweenLines?.() as number) || ((stave.getYForLine(4) - topY) / 4);
  const minL = -EXTRA_TOP_LINES, maxL = 4 + EXTRA_BOTTOM_LINES;
  let best = 0, diff = Infinity;
  for (let l = minL; l <= maxL; l += 0.5) {
    const yc = topY + l * sp; const d = Math.abs(y - yc);
    if (d < diff) { diff = d; best = Number(l.toFixed(1)); }
  }
  return best;
}

/* ===== ノート生成（臨時記号を付与） ===== */
function makeVFNote(ev: NoteEvent) {
  const vfDur = toVFDur(ev.dur);
  if (ev.isRest) {
    const n = new StaveNote({ clef: 'treble', keys: ['b/4'], duration: (vfDur as VFDur) + 'r' });
    (n as any).setCenterAlignment?.(true);
    return n;
  }
  const n = new StaveNote({ clef: 'treble', keys: [ev.key], duration: vfDur });
  const m = ev.key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i);
  const acc = m?.[2] || '';
  if (acc) {
    try { (n as any).addModifier?.(0, new Accidental(acc)); (n as any).addAccidental?.(0, new Accidental(acc)); } catch {}
  }
  return n;
}

export default function StaffCanvas({
  systems = 6, gap = 110, measuresPerSystem = 4, tool, scale = 0.86,
  initialScoreData, onScoreDataChange,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState<MeasureData[]>(() => {
    // Use initialScoreData if provided, otherwise create empty measures
    if (initialScoreData && initialScoreData.length > 0) {
      return initialScoreData;
    }
    return Array.from({ length: systems * measuresPerSystem }, () => ({ events: [] }));
  });
  const [selected, setSelected] = useState<{ measure: number; index: number } | null>(null);

  // Update score when initialScoreData changes (when loading data)
  useEffect(() => {
    if (initialScoreData && initialScoreData.length > 0) {
      setScore(initialScoreData);
      setSelected(null); // Clear selection when loading new data
    }
  }, [initialScoreData]);

  // Call callback when score data changes
  useEffect(() => {
    if (onScoreDataChange) {
      onScoreDataChange(score);
    }
  }, [score, onScoreDataChange]);

  useEffect(() => {
    // Only reset to empty measures if no initialScoreData is provided
    if (!initialScoreData || initialScoreData.length === 0) {
      setScore(Array.from({ length: systems * measuresPerSystem }, () => ({ events: [] })));
      setSelected(null);
    }
  }, [systems, measuresPerSystem, initialScoreData]);

  /* ===== キー操作（削除/上下移動/解除） ===== */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected) return;
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

          if (e.altKey) { // 半音
            const midi = keyToMidi(ev.key); if (midi == null) return prev;
            const nextMidi = midi + (up ? 1 : -1);
            const newKey = midiToKey(nextMidi, up);
            const next = prev.map(m => ({ events: [...m.events] as NoteEvent[] }));
            next[measure].events[index] = { ...ev, key: newKey };
            return next;
          }

          if (e.shiftKey) { // 1オクターブ
            const diff = up ? -3.5 : 3.5;
            const newKey = lineToKeyTreble(keyToLineTreble(ev.key) + diff);
            const next = prev.map(m => ({ events: [...m.events] as NoteEvent[] }));
            next[measure].events[index] = { ...ev, key: newKey };
            return next;
          }

          // 線/間 1段
          const diff = up ? -0.5 : 0.5;
          const newKey = lineToKeyTreble(keyToLineTreble(ev.key) + diff);
          const next = prev.map(m => ({ events: [...m.events] as NoteEvent[] }));
          next[measure].events[index] = { ...ev, key: newKey };
          return next;
        });
        e.preventDefault(); return;
      }

      if (e.key === 'Escape') { setSelected(null); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

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

    // 🛠️ ここで一度だけ root グループを取得して、以降は使い回す
    const svgRoot = (getVexflowGroup(svg) as SVGGElement | null) || svg;

    const s = Math.max(0.75, Math.min(1.0, scale ?? 1));
    ctx.scale(s, s);

    const innerW = W - PAGE_LEFT - PAGE_RIGHT;
    const left = PAGE_LEFT;

    let globalIndex = 0;

    for (let line = 0; line < systems; line++) {
      if (globalIndex >= score.length) break;

      const y = top + line * gap;
      const CLEF_PAD_THIS = (line === 0) ? CLEF_PAD_FIRST : CLEF_PAD_OTHER;

      // 何小節入れるか試す
      const candidates = [measuresPerSystem, 3, 2, 1].filter((v,i,a)=>a.indexOf(v)===i);
      let chosen = 1, widths: number[] = [], startX = left;

      const tryFit = (n: number) => {
        const last = Math.min(globalIndex + n, score.length);
        const items = score.slice(globalIndex, last);
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

      for (let i = 0; i < chosen && globalIndex < score.length; i++, globalIndex++) {
        const w = widths[i];
        const data: MeasureData | undefined = score[globalIndex];

        const stave = new Stave(x / s, y / s, w / s);
        if (i === 0) { stave.addClef('treble'); if (line === 0) stave.addTimeSignature('4/4'); }
        stave.setEndBarType(Barline.type.SINGLE);
        stave.setContext(ctx).draw();

        const safeEvents: NoteEvent[] =
          (data?.events?.length ? data.events : [{ dur:'1', isRest:true, key:'b/4' }])
          .map(ev => (!ev || !ev.dur ? { dur:'4' as DurKey, isRest:true, key:'b/4' } : {
            ...ev,
            dur: ev.dur as DurKey
          }));

        const vfNotes: StaveNote[] = safeEvents.map((ev, idx) => {
          const n = makeVFNote(ev) as any;
          const isSel = !!selected && selected.measure === globalIndex && selected.index === idx;
          if (isSel && n.setStyle) n.setStyle({ fillStyle:'#1d4ed8', strokeStyle:'#1d4ed8' });
          return n as StaveNote;
        });

        const beams = Beam.generateBeams(vfNotes, { beamRests: false });
        const voice = new Voice({ time: { num_beats: BEATS_PER_MEASURE, beat_value: 4 } } as any);
        voice.setMode((Voice as any).Mode.SOFT ?? 1);
        voice.addTickables(vfNotes);
        new Formatter().joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(ctx, stave);
        beams.forEach(b => b.setContext(ctx).draw());

        const measureIndex = globalIndex;
        const xDraw = x / s, wDraw = w / s;
        const measLeft = xDraw, measRight = xDraw + wDraw;

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
          const snapped = snapLineBySpacing(stave, localY);
          const yGuide = stave.getYForLine(snapped);
          guideLine.setAttribute('y1', String(yGuide));
          guideLine.setAttribute('y2', String(yGuide));
          guideLine.style.display = 'block';
          const cx = Math.max(measLeft, Math.min(localX, measRight));
          guideDot.setAttribute('cx', String(cx));
          guideDot.setAttribute('cy', String(yGuide));
          guideDot.style.display = 'block';
        };
        const hideGuide = () => {
          guideLine.style.display = 'none';
          guideDot.style.display = 'none';
        };

        /* --- 挿入処理（クリック座標→どこに挿入するか決めて追加） --- */
        const doInsertAt = (localX: number, localY: number) => {
          const snappedLine = snapLineBySpacing(stave, localY);
          const key = lineToKeyTreble(snappedLine);

          let insertAt = safeEvents.length;
          let minDist = Infinity;

          if (vfNotes.length > 0) {
            const dL = Math.abs(localX - measLeft); if (dL < minDist) { minDist = dL; insertAt = 0; }
            const dR = Math.abs(localX - measRight); if (dR < minDist) { minDist = dR; insertAt = vfNotes.length; }

            for (let j = 0; j < vfNotes.length; j++) {
              const n: any = vfNotes[j];
              const leftX = n.getAbsoluteX ? n.getAbsoluteX() : (measLeft + j * 20);
              const bb = n.getBoundingBox?.();
              const width = bb ? bb.getW() : 20;
              const rightX = leftX + width;

              if (localX >= leftX && localX <= rightX) {
                insertAt = (localX < (leftX + rightX) / 2) ? j : (j + 1);
                minDist = 0; break;
              }
              if (localX < leftX) { const d = leftX - localX; if (d < minDist) { minDist = d; insertAt = j; } }
              if (localX > rightX) { const d = localX - rightX; if (d < minDist) { minDist = d; insertAt = j + 1; } }
            }
          }

          setScore(prev => {
            const next = prev.map(m => ({ events: [...(m?.events ?? [])] as NoteEvent[] }));
            while (measureIndex >= next.length) next.push({ events: [] });
            const m = next[measureIndex];

            const vfDur = toVFDur((tool as any)?.duration);
            const addBeats = beatsFromVF(vfDur);
            const curBeats = m.events.reduce((s2, ev) => s2 + beatsFromVF(toVFDur(ev.dur)), 0);
            if (curBeats + addBeats > BEATS_PER_MEASURE) return prev;

            const ev: NoteEvent = {
              dur: (['1','2','4','8','16','32','64'].includes((tool as any)?.duration) ? (tool as any).duration : '4') as DurKey,
              isRest: !!(tool as any)?.isRest,
              key,
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
          const { x: lx, y: ly } = clientToGroup(svg, svgRoot as SVGGElement, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
          updateGuide(lx, ly);
        });
        insertRect.addEventListener('mouseleave', hideGuide);
        insertRect.addEventListener('click', (e) => {
          // より正確な座標変換：SVGの変換行列を使用
          const { x: lx, y: ly } = clientToGroup(svg, svgRoot as SVGGElement, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
          
          const linePos = Math.round(stave.getLineForY(ly) * 2) / 2;
          const key = lineToKeyTreble(linePos);

          setScore(prev => {
            const next = prev.map(m => ({ events: [...(m?.events ?? [])] as NoteEvent[] }));
            while (measureIndex >= next.length) next.push({ events: [] });
            const m = next[measureIndex];

            const addBeats = beatsFromVF(toVFDur((tool as any)?.duration));
            const curBeats = m.events.reduce((s2, ev) => s2 + beatsFromVF(toVFDur(ev.dur)), 0);
            if (curBeats + addBeats > BEATS_PER_MEASURE) return prev;

            // 小節内の相対位置から挿入位置を計算
            const relX = lx - measLeft;
            const clickBeat = Math.max(0, Math.min(BEATS_PER_MEASURE, (relX / wDraw) * BEATS_PER_MEASURE));

            let acc = 0, insertAt = m.events.length;
            for (let j = 0; j < m.events.length; j++) {
              const b = beatsFromVF(toVFDur(m.events[j].dur));
              if (clickBeat <= acc + b / 2) { insertAt = j; break; }
              acc += b;
            }

            const ev: NoteEvent = {
              dur: (['1','2','4','8','16','32','64'].includes((tool as any)?.duration) ? (tool as any).duration : '4') as DurKey,
              isRest: !!(tool as any)?.isRest,
              key,
            };
            m.events.splice(insertAt, 0, ev);
            return next;
          });
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
            const yCenter = evData?.isRest ? stave.getYForLine(2) : stave.getYForLine(keyToLineTreble(evData.key));
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
              const { x: lx, y: ly } = clientToGroup(svg, svgRoot as SVGGElement, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
              updateGuide(lx, ly);
            });
            hit.addEventListener('mouseenter', (ev) => {
              const { x: lx, y: ly } = clientToGroup(svg, svgRoot as SVGGElement, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
              updateGuide(lx, ly);
            });
            hit.addEventListener('mouseleave', hideGuide);

            // クリック：近ければ選択、離れていれば挿入
            hit.addEventListener('click', (ev) => {
              ev.stopPropagation(); // 小節rectには渡さない
              const { x: lx, y: ly } = clientToGroup(svg, svgRoot as SVGGElement, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
              const cellW = rawRight - rawLeft;
              const selRadius = Math.min(SELECT_NEAR_PX, Math.max(0, cellW * SELECT_NEAR_FRAC));
              const dx = Math.abs(lx - anchors[j]);
              if (dx <= selRadius) {
                setSelected({ measure: measureIndex, index: j });
              } else {
                doInsertAt(lx, ly);
              }
            });

            (svgRoot as any).appendChild(hit);

            const isSel = !!selected && selected.measure === measureIndex && selected.index === j;
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
