import { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline, Beam } from 'vexflow';
import type { Tool } from './Palette';

/* ============================================================
   ✅ 編集機能 ＋ 右端ノート選択バグの再修正版
      - 既存音符のクリック選択（青枠）
      - Delete/Backspace … 削除
      - ↑/↓ … 五線の線/間 1つ分
      - Shift+↑/↓ … 1オクターブ
      - Esc … 選択解除
      - 🩹 音符ヒットボックスを「パディング + クランプ + 再計算」で確実に当てる
   ------------------------------------------------------------
   ★右端で選べない典型原因：
     1) BBox が小節右境界を越えて返る
     2) そのままクランプすると xHit は右へ寄るが wHit がマイナス/極小になる
     3) クリックが “小節ヒット矩形” に奪われ、選択ではなく挿入が走る
   → 解決：左右パディングを足し「左端/右端を境界内へ丸め、最後に幅を再計算」
   ============================================================ */

type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';
type NoteEvent = { dur: DurKey; isRest: boolean; key: string };
type MeasureData = { events: NoteEvent[] };

type Props = {
  systems?: number;
  gap?: number;
  measuresPerSystem?: number;
  tool: Tool;
  scale?: number; // 0.75〜1.0 推奨
};

/* ===== レイアウト関連（必要に応じて調整OK） ===== */
const TARGET_FILL = 0.99;
const PAGE_LEFT = 4;
const PAGE_RIGHT = 4;

const MIN_MEASURE_W = 52;
const LONG_HALF_MIN = 80;
const LONG_WHOLE_MIN = 92;

const BASE_PAD = 14;
const UNIT_WIDTH = 9;
const FLAG_EXTRA_PX = 4;

const CLEF_PAD_FIRST = 50;
const CLEF_PAD_OTHER = 28;
const EMPTY_MEASURE_UNITS = 0.6;
const BEATS_PER_MEASURE = 4;

/* ===== 五線の上下もクリック可能にする拡張量 ===== */
const EXTRA_TOP_LINES = 6;     // 上方向
const EXTRA_BOTTOM_LINES = 10; // 下方向

/* ===== ヒットボックスの安全パラメータ ===== */
const HIT_PAD_X = 10;      // ← 左右にこれだけ“盛る”（音符の左右に余裕を持たせる）
const HIT_MIN_W = 14;      // ← 最低でもこれだけの幅は確保
const HIT_MIN_H_FACTOR = 2.2; // ← 線間×係数 だけは高さを確保

/* ===== duration 変換ユーティリティ ===== */
type VFDur = 'w'|'h'|'q'|'8'|'16'|'32'|'64';
const toVFDur = (d: DurKey | string | undefined | null): VFDur =>
  d==='1'?'w':d==='2'?'h':d==='4'?'q':d==='8'?'8':d==='16'?'16':d==='32'?'32':d==='64'?'64':'q';
const beatsFromVF = (vf: VFDur) =>
  vf==='64'?1/16 : vf==='32'?1/8 : vf==='16'?1/4 : vf==='8'?1/2 : vf==='q'?1 : vf==='h'?2 : 4;
const vfToDenom = (vf: VFDur | string) =>
  vf==='64'?64 : vf==='32'?32 : vf==='16'?16 : vf==='8'?8 : vf==='q'?4 : vf==='h'?2 : 1;

/* ===== スペーシング重み（音価に応じた幅の配分） ===== */
const UNIT_BY_DENOM: Record<number, number> = {
  1: 1.45, 2: 1.25, 4: 1.00, 8: 0.60, 16: 0.50, 32: 2.20, 64: 2.60,
};
function unitsForEvent(ev: NoteEvent): number {
  const denom = vfToDenom(toVFDur(ev.dur));
  const base = UNIT_BY_DENOM[denom] ?? 1.0;
  const restFactor = ev.isRest ? 0.85 : 1.0;
  const flagExtra = denom >= 16 ? (FLAG_EXTRA_PX / UNIT_WIDTH) : 0;
  return base * restFactor + flagExtra;
}
function minContentWidth(m?: MeasureData): number {
  if (!m || !m.events?.length) {
    return Math.max(MIN_MEASURE_W, BASE_PAD + UNIT_WIDTH * EMPTY_MEASURE_UNITS);
  }
  let hasHalf = false, hasWhole = false;
  const units = m.events.reduce((s, ev) => {
    const d = vfToDenom(toVFDur(ev.dur));
    if (d === 2) hasHalf = true;
    if (d === 1) hasWhole = true;
    return s + unitsForEvent(ev);
  }, 0);
  const raw = Math.max(MIN_MEASURE_W, BASE_PAD + UNIT_WIDTH * units);
  if (hasWhole) return Math.max(raw, LONG_WHOLE_MIN);
  if (hasHalf)  return Math.max(raw, LONG_HALF_MIN);
  return raw;
}

/* ===== ト音記号の line ⇄ key 変換 =====
   - line=0 が最上線(F5)。下に行くほど +0.5 ずつ増える。 */
function lineToKeyTreble(line: number): string {
  const snapped = Math.round(line * 2) / 2;
  const stepsDown = Math.round(snapped * 2); // F5 から何半線分か
  const letters = ['c','d','e','f','g','a','b'] as const;
  let idx = 3 - stepsDown; // 3:'f'
  let oct = 5;
  while (idx < 0) { idx += 7; oct -= 1; }
  while (idx >= 7) { idx -= 7; oct += 1; }
  return `${letters[idx]}/${oct}`;
}
function keyToLineTreble(key: string): number {
  const m = key.match(/^([a-g])\/([0-9]+)$/i);
  if (!m) return 2;
  const letter = m[1].toLowerCase();
  const oct = parseInt(m[2], 10);
  const idxMap: Record<string, number> = { c:0,d:1,e:2,f:3,g:4,a:5,b:6 };
  const targetIndex = oct * 7 + (idxMap[letter] ?? 0);
  const baseIndex = 5 * 7 + idxMap['f']; // F5 基準
  const stepsDown = baseIndex - targetIndex;
  return stepsDown / 2;
}

/* ===== SVGグループと座標変換（マウス座標→SVG座標） ===== */
function getVexflowGroup(svg: SVGSVGElement): SVGGElement | null {
  const groups = svg.querySelectorAll('g');
  return groups.length ? (groups[groups.length - 1] as SVGGElement) : null;
}
function clientToGroup(svg: SVGSVGElement, group: SVGGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const m = (group as any).getScreenCTM?.();
  if (!m) return { x: 0, y: 0 };
  const p = pt.matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

/* ===== Y → line を“行間スナップ”で求める ===== */
function snapLineBySpacing(stave: Stave, y: number): number {
  const topY = stave.getYForLine(0);
  const spacing = (stave.getSpacingBetweenLines?.() as number) || ((stave.getYForLine(4) - topY) / 4);
  const minLine = -EXTRA_TOP_LINES;
  const maxLine = 4 + EXTRA_BOTTOM_LINES;

  let bestLine = 0;
  let bestDiff = Infinity;
  for (let l = minLine; l <= maxLine; l += 0.5) {
    const yc = topY + l * spacing;
    const d = Math.abs(y - yc);
    if (d < bestDiff) { bestDiff = d; bestLine = Number(l.toFixed(1)); }
  }
  return bestLine;
}

/* ===== VexFlowノート生成（休符は 'b/4' のセンター寄せでOK） ===== */
function makeVFNote(ev: NoteEvent) {
  const vfDur = toVFDur(ev.dur);
  if (ev.isRest) {
    const n = new StaveNote({ clef: 'treble', keys: ['b/4'], duration: (vfDur as VFDur) + 'r' });
    (n as any).setCenterAlignment?.(true);
    return n;
  }
  return new StaveNote({ clef: 'treble', keys: [ev.key], duration: vfDur });
}

export default function StaffCanvas({
  systems = 6,
  gap = 110,
  measuresPerSystem = 4,
  tool,
  scale = 0.86,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // 譜面データ
  const [score, setScore] = useState<MeasureData[]>(
    Array.from({ length: systems * measuresPerSystem }, () => ({ events: [] }))
  );

  // 選択中の音符（どの小節の何番目か）
  const [selected, setSelected] = useState<{ measure: number; index: number } | null>(null);

  // 段数/小節数が変わったらスコアを作り直す
  useEffect(() => {
    setScore(Array.from({ length: systems * measuresPerSystem }, () => ({ events: [] })));
    setSelected(null);
  }, [systems, measuresPerSystem]);

  // キーボード操作（Delete/Backspace, 矢印, Esc）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected) return;
      const { measure, index } = selected;
      const inRange = (arr: any[], i: number) => i >= 0 && i < arr.length;

      // 削除
      if (e.key === 'Delete' || e.key === 'Backspace') {
        setScore(prev => {
          if (!inRange(prev, measure)) return prev;
          const next = prev.map(m => ({ events: [...m.events] }));
          if (!inRange(next[measure].events, index)) return prev;
          next[measure].events.splice(index, 1);
          return next;
        });
        setSelected(null); // シンプルに解除
        e.preventDefault();
        return;
      }

      // 音程変更（休符は変えない）
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        setScore(prev => {
          if (!inRange(prev, measure)) return prev;
          const cur = prev[measure];
          if (!inRange(cur.events, index)) return prev;
          const ev = cur.events[index];
          if (ev.isRest) return prev;

          const diffLine = (e.shiftKey ? 3.5 : 0.5) * (e.key === 'ArrowUp' ? -1 : 1);
          const currentLine = keyToLineTreble(ev.key);
          const newKey = lineToKeyTreble(currentLine + diffLine);

          const next = prev.map(m => ({ events: [...m.events] as NoteEvent[] }));
          (next[measure].events[index] = { ...ev, key: newKey });
          return next;
        });
        e.preventDefault();
        return;
      }

      // 選択解除
      if (e.key === 'Escape') {
        setSelected(null);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  // 描画
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';

    // キャンバス
    const W = ref.current.parentElement?.clientWidth ?? ref.current.clientWidth ?? 700;
    const top = 10, bottom = 30, H = top + systems * gap + bottom;

    // VexFlow
    const renderer = new Renderer(ref.current, Renderer.Backends.SVG);
    renderer.resize(W, H);
    const ctx = renderer.getContext();

    const svg = ref.current.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;

    // 見た目縮小
    const s = Math.max(0.75, Math.min(1.0, scale ?? 1));
    ctx.scale(s, s);

    const innerW = W - PAGE_LEFT - PAGE_RIGHT;
    const left = PAGE_LEFT;

    let globalIndex = 0;

    for (let line = 0; line < systems; line++) {
      if (globalIndex >= score.length) break;

      const y = top + line * gap;
      const CLEF_PAD_THIS = (line === 0) ? CLEF_PAD_FIRST : CLEF_PAD_OTHER;

      // この段に何小節入れるか試す
      const candidates = [measuresPerSystem, 3, 2, 1].filter((v, i, a) => a.indexOf(v) === i);
      let chosenCount = 1, widths: number[] = [], startX = left;

      const tryFit = (n: number) => {
        const last = Math.min(globalIndex + n, score.length);
        const items = score.slice(globalIndex, last);

        let occupy = innerW * TARGET_FILL;
        if (n === 1) occupy = innerW;

        const allocContentW = Math.max(0, occupy - CLEF_PAD_THIS);

        const minWs = items.map(minContentWidth);
        while (minWs.length < n) minWs.push(MIN_MEASURE_W);

        const unitWeights = items.map(m =>
          m?.events?.length ? m.events.reduce((u, ev) => u + unitsForEvent(ev), 0) : EMPTY_MEASURE_UNITS
        );
        while (unitWeights.length < n) unitWeights.push(EMPTY_MEASURE_UNITS);

        const sumMin = minWs.reduce((a, b) => a + b, 0);
        if (sumMin > allocContentW * 1.002) return null;

        const extra = Math.max(0, allocContentW - sumMin);
        const weightSum = unitWeights.reduce((a, b) => a + b, 0) || 1;
        const contentW = minWs.map((w, i) => w + extra * (unitWeights[i] / weightSum));

        const realWs = contentW.map((w, i) => (i === 0 ? w + CLEF_PAD_THIS : w));
        const need = realWs.reduce((a, b) => a + b, 0);
        const start = left + (innerW - occupy) / 2;

        if (need > occupy * 1.002 && n > 1) return null;
        return { widths: realWs, startX: start };
      };

      let fitted: null | { widths: number[]; startX: number } = null;
      for (const n of candidates) {
        fitted = tryFit(n);
        if (fitted) { chosenCount = n; widths = fitted.widths; startX = fitted.startX; break; }
      }
      if (!fitted) { chosenCount = 1; widths = [innerW]; startX = left; }

      let x = startX;

      for (let i = 0; i < chosenCount && globalIndex < score.length; i++, globalIndex++) {
        const w = widths[i];
        const data: MeasureData | undefined = score[globalIndex];

        // 描画は /s（ctx.scale 済み）
        const stave = new Stave(x / s, y / s, w / s);
        if (i === 0) {
          stave.addClef('treble');
          if (line === 0) stave.addTimeSignature('4/4');
        }
        stave.setEndBarType(Barline.type.SINGLE);
        stave.setContext(ctx).draw();

        // 中身（空なら全休符を暫定表示）
        const safeEvents: NoteEvent[] =
          (data?.events?.length ? data.events : [{ dur: '1', isRest: true, key: 'b/4' }])
          .map(ev => (!ev || !ev.dur ? { dur: '4', isRest: true, key: 'b/4' } : ev));

        // VexFlowノート
        const vfNotes: StaveNote[] = safeEvents.map((ev, idx) => {
          const n = makeVFNote(ev) as any;
          const isSel = !!selected && selected.measure === globalIndex && selected.index === idx;
          if (isSel && n.setStyle) {
            n.setStyle({ fillStyle: '#1d4ed8', strokeStyle: '#1d4ed8' });
          }
          return n as StaveNote;
        });

        // ビーム（8分以下を自動連桁）
        const beams = Beam.generateBeams(vfNotes, { beam_rests: false });

        // Voice
        const voice = new Voice({ time: { num_beats: BEATS_PER_MEASURE, beat_value: 4 } } as any);
        voice.setMode((Voice as any).Mode.SOFT ?? 1);
        voice.addTickables(vfNotes);
        new Formatter({ align_rests: true }).joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(ctx, stave);
        beams.forEach(b => b.setContext(ctx).draw());

        // ====== クリック矩形とガイド ======
        const group = getVexflowGroup(svg) || svg;
        const measureIndex = globalIndex;
        const xDraw = x / s;
        const wDraw = w / s;
        const measLeft = xDraw;
        const measRight = xDraw + wDraw;

        // ガイド（クリックの邪魔をしない）
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
        guideDot.setAttribute('cx', String(xDraw));
        guideDot.setAttribute('cy', '0');

        (getVexflowGroup(svg) || svg).appendChild(guideLine);
        (getVexflowGroup(svg) || svg).appendChild(guideDot);

        // 小節全体の当たり判定（挿入用）
        const rectTop = stave.getYForLine(-EXTRA_TOP_LINES);
        const rectBottom = stave.getYForLine(4 + EXTRA_BOTTOM_LINES);
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'vf-hit');
        rect.setAttribute('x', String(measLeft));
        rect.setAttribute('y', String(rectTop));
        rect.setAttribute('width', String(wDraw));
        rect.setAttribute('height', String(rectBottom - rectTop));
        rect.setAttribute('fill', 'transparent');
        rect.setAttribute('stroke', 'none');
        rect.setAttribute('pointer-events', 'all');
        (rect.style as any).cursor = 'crosshair';

        // ガイド表示
        rect.addEventListener('mousemove', (e) => {
          const { x: localX, y: localY } =
            clientToGroup(svg, group as SVGGElement, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
          const snappedLine = snapLineBySpacing(stave, localY);
          const yGuide = stave.getYForLine(snappedLine);
          guideLine.setAttribute('y1', String(yGuide));
          guideLine.setAttribute('y2', String(yGuide));
          guideLine.style.display = 'block';
          const clampedX = Math.max(measLeft, Math.min(localX, measRight));
          guideDot.setAttribute('cx', String(clampedX));
          guideDot.setAttribute('cy', String(yGuide));
          guideDot.style.display = 'block';
        });
        rect.addEventListener('mouseleave', () => {
          guideLine.style.display = 'none';
          guideDot.style.display = 'none';
        });

        // クリック（挿入）
        rect.addEventListener('click', (e) => {
          const { x: localX, y: localY } =
            clientToGroup(svg, group as SVGGElement, (e as MouseEvent).clientX, (e as MouseEvent).clientY);

          const snappedLine = snapLineBySpacing(stave, localY);
          const key = lineToKeyTreble(snappedLine);

          // Xの挿入位置決定
          let insertAt = safeEvents.length;
          let minDist = Infinity;

          if (vfNotes.length > 0) {
            const dL = Math.abs(localX - measLeft);
            if (dL < minDist) { minDist = dL; insertAt = 0; }
            const dR = Math.abs(localX - measRight);
            if (dR < minDist) { minDist = dR; insertAt = vfNotes.length; }

            for (let j = 0; j < vfNotes.length; j++) {
              const n: any = vfNotes[j];
              const leftX = n.getAbsoluteX ? n.getAbsoluteX() : (measLeft + j * 20);
              const bb = n.getBoundingBox?.();
              const width = bb ? bb.getW() : 20;
              const rightX = leftX + width;

              if (localX >= leftX && localX <= rightX) {
                insertAt = (localX < (leftX + rightX) / 2) ? j : (j + 1);
                minDist = 0;
                break;
              }
              if (localX < leftX) {
                const d = leftX - localX;
                if (d < minDist) { minDist = d; insertAt = j; }
              }
              if (localX > rightX) {
                const d = localX - rightX;
                if (d < minDist) { minDist = d; insertAt = j + 1; }
              }
            }
          }

          // 拍オーバーを超えないように追加
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
        });

        (getVexflowGroup(svg) || svg).appendChild(rect);

        // 🆕 各音符のクリック用ヒットボックス
        vfNotes.forEach((n: any, j: number) => {
          const bb = n.getBoundingBox?.();
          const evData = safeEvents[j];

          // 絶対X（音符の左側の基準位置）
          const leftX = n.getAbsoluteX ? n.getAbsoluteX() : (measLeft + 8 + j * 20);
          const bbW = bb?.getW ? bb.getW() : 22;
          const bbX = bb?.getX ? bb.getX() : (leftX - 6);
          const rightXRaw = bbX + bbW;

          // 1) 左右にパディングを付けた「理想」ヒット範囲
          let xLeftIdeal = Math.min(bbX, leftX) - HIT_PAD_X;
          let xRightIdeal = Math.max(rightXRaw, leftX + bbW) + HIT_PAD_X;

          // 2) 小節境界でクランプ（境界の 1px 内側まで）
          const xLeft = Math.max(measLeft + 1, xLeftIdeal);
          const xRight = Math.min(measRight - 1, xRightIdeal);

          // 3) 幅を再計算して最小幅を保証
          let wHit = Math.max(HIT_MIN_W, xRight - xLeft);
          let xHit = xLeft;

          // もしクランプの結果、最小幅が取れないほどギリギリなら左へ寄せて確保
          if (xHit + wHit > measRight - 1) {
            xHit = Math.max(measLeft + 1, (measRight - 1) - wHit);
          }

          // Y方向の安全な中央と高さを計算（休符は五線中央）
          const spacing = (stave.getSpacingBetweenLines?.() as number) || ((stave.getYForLine(4) - stave.getYForLine(0)) / 4);
          const yCenter = evData?.isRest
            ? stave.getYForLine(2) // 五線中央
            : stave.getYForLine(keyToLineTreble(evData.key));
          const safeH = Math.max(bb?.getH?.() ?? 26, spacing * HIT_MIN_H_FACTOR); // 最低高さの保証
          const safeY = yCenter - safeH / 2;

          // 透明クリック領域（最前面・クリックを受ける）
          const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          hit.setAttribute('class', 'vf-note-hit');
          hit.setAttribute('x', String(xHit));
          hit.setAttribute('y', String(safeY));
          hit.setAttribute('width', String(wHit));
          hit.setAttribute('height', String(safeH));
          hit.setAttribute('fill', 'transparent');
          hit.setAttribute('stroke', 'none');
          hit.setAttribute('pointer-events', 'all');
          (hit.style as any).cursor = 'pointer';
          hit.addEventListener('click', (ev) => {
            ev.stopPropagation(); // 小節の挿入クリックに届かないように
            setSelected({ measure: measureIndex, index: j });
          });
          (getVexflowGroup(svg) || svg).appendChild(hit);

          // 選択枠（見た目だけ）
          const isSel = !!selected && selected.measure === measureIndex && selected.index === j;
          if (isSel) {
            const sel = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            sel.setAttribute('class', 'vf-note-selected');
            sel.setAttribute('x', String(xHit - 3));
            sel.setAttribute('y', String(safeY - 3));
            sel.setAttribute('width', String(wHit + 6));
            sel.setAttribute('height', String(safeH + 6));
            sel.setAttribute('rx', '4');
            sel.setAttribute('ry', '4');
            (getVexflowGroup(svg) || svg).appendChild(sel);
          }
        });

        x += w;
      }
    }
  }, [systems, gap, measuresPerSystem, score, tool, scale, selected]);

  return <div ref={ref} />;
}
