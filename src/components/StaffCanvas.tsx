import { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline, Beam } from 'vexflow';
import type { Tool } from './Palette';

/* ============================================================
   ✅ クリック座標と描画座標を統一 / 上下の加線領域までクリック可能
   🆕 ガイド表示：マウス位置にスナップした高さへ薄い破線＋点を描画
   ------------------------------------------------------------
   - クリック当たり判定 <rect> は .vf-hit（完全不可視・印刷除外）
   - Yは getSpacingBetweenLines() を使い 0.5 行間でスナップ
   - Xは見た目の位置（getAbsoluteX + BoundingBox）で挿入点を決定
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

/* ===== 見た目パラメータ ===== */
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
const EXTRA_TOP_LINES = 6;     // 上方向（-6本分）
const EXTRA_BOTTOM_LINES = 10; // 下方向（+10本分）

/* ===== duration 変換 ===== */
type VFDur = 'w'|'h'|'q'|'8'|'16'|'32'|'64';
const toVFDur = (d: DurKey | string | undefined | null): VFDur =>
  d==='1'?'w':d==='2'?'h':d==='4'?'q':d==='8'?'8':d==='16'?'16':d==='32'?'32':d==='64'?'64':'q';
const beatsFromVF = (vf: VFDur) =>
  vf==='64'?1/16 : vf==='32'?1/8 : vf==='16'?1/4 : vf==='8'?1/2 : vf==='q'?1 : vf==='h'?2 : 4;
const vfToDenom = (vf: VFDur | string) =>
  vf==='64'?64 : vf==='32'?32 : vf==='16'?16 : vf==='8'?8 : vf==='q'?4 : vf==='h'?2 : 1;

/* ===== スペーシング重み ===== */
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

/* ===== line → 音名（ト音記号基準） =====
   line=0 が最上線(F5)。0.5刻みで下に増える。 */
function lineToKeyTreble(line: number): string {
  const snapped = Math.round(line * 2) / 2;
  const stepsDown = Math.round(snapped * 2);
  const letters = ['c','d','e','f','g','a','b'] as const;
  let idx = 3 - stepsDown; // 3:'f'
  let oct = 5;
  while (idx < 0) { idx += 7; oct -= 1; }
  while (idx >= 7) { idx -= 7; oct += 1; }
  return `${letters[idx]}/${oct}`;
}

/* ===== <svg>/<g> 取得と座標変換 ===== */
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

/* ===== コンポーネント ===== */
export default function StaffCanvas({
  systems = 6,
  gap = 110,
  measuresPerSystem = 4,
  tool,
  scale = 0.86,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const [score, setScore] = useState<MeasureData[]>(
    Array.from({ length: systems * measuresPerSystem }, () => ({ events: [] }))
  );

  useEffect(() => {
    setScore(Array.from({ length: systems * measuresPerSystem }, () => ({ events: [] })));
  }, [systems, measuresPerSystem]);

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

    // 見た目縮小（描画値は /s、座標はCTMで吸収）
    const s = Math.max(0.75, Math.min(1.0, scale ?? 1));
    ctx.scale(s, s);

    const innerW = W - PAGE_LEFT - PAGE_RIGHT;
    const left = PAGE_LEFT;

    let globalIndex = 0;

    for (let line = 0; line < systems; line++) {
      if (globalIndex >= score.length) break;

      const y = top + line * gap;
      const CLEF_PAD_THIS = (line === 0) ? CLEF_PAD_FIRST : CLEF_PAD_OTHER;

      // 段の中でできるだけ多く小節を入れる
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

        const safeEvents: NoteEvent[] =
          (data?.events?.length ? data.events : [{ dur: '1', isRest: true, key: 'b/4' }])
          .map(ev => (!ev || !ev.dur ? { dur: '4', isRest: true, key: 'b/4' } : ev));

        const vfNotes = safeEvents.map(ev => makeVFNote(ev));
        const beams = Beam.generateBeams(vfNotes, { beam_rests: false });

        const voice = new Voice({ time: { num_beats: BEATS_PER_MEASURE, beat_value: 4 } } as any);
        voice.setMode((Voice as any).Mode.SOFT ?? 1);
        voice.addTickables(vfNotes);
        new Formatter({ align_rests: true }).joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(ctx, stave);
        beams.forEach(b => b.setContext(ctx).draw());

        // クリック矩形とガイド（同じ <g> に置く）
        const group = getVexflowGroup(svg) || svg;
        const measureIndex = globalIndex;
        const xDraw = x / s;
        const wDraw = w / s;

        // 🟦 ガイド要素（最初に作って非表示に）
        const guideLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        guideLine.setAttribute('class', 'vf-guide-line');
        guideLine.style.display = 'none';
        guideLine.setAttribute('x1', String(xDraw));
        guideLine.setAttribute('x2', String(xDraw + wDraw));
        guideLine.setAttribute('y1', '0');
        guideLine.setAttribute('y2', '0');

        const guideDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        guideDot.setAttribute('class', 'vf-guide-dot');
        guideDot.style.display = 'none';
        guideDot.setAttribute('r', '2.8');
        guideDot.setAttribute('cx', String(xDraw));
        guideDot.setAttribute('cy', '0');

        (getVexflowGroup(svg) || svg).appendChild(guideLine);
        (getVexflowGroup(svg) || svg).appendChild(guideDot);

        // 🟩 当たり判定：五線の上下まで拡張
        const rectTop = stave.getYForLine(-EXTRA_TOP_LINES);
        const rectBottom = stave.getYForLine(4 + EXTRA_BOTTOM_LINES);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'vf-hit');              // 完全不可視＋印刷除外
        rect.setAttribute('x', String(xDraw));
        rect.setAttribute('y', String(rectTop));
        rect.setAttribute('width', String(wDraw));
        rect.setAttribute('height', String(rectBottom - rectTop));
        rect.setAttribute('fill', 'transparent');
        rect.setAttribute('stroke', 'none');
        rect.setAttribute('pointer-events', 'all');
        (rect.style as any).cursor = 'crosshair';

        // --- ガイド表示：mousemove で更新、mouseleave で非表示
        rect.addEventListener('mousemove', (e) => {
          const { x: localX, y: localY } =
            clientToGroup(svg, group as SVGGElement, (e as MouseEvent).clientX, (e as MouseEvent).clientY);

          const snappedLine = snapLineBySpacing(stave, localY);
          const yGuide = stave.getYForLine(snappedLine);

          guideLine.setAttribute('y1', String(yGuide));
          guideLine.setAttribute('y2', String(yGuide));
          guideLine.style.display = 'block';

          const clampedX = Math.max(xDraw, Math.min(localX, xDraw + wDraw));
          guideDot.setAttribute('cx', String(clampedX));
          guideDot.setAttribute('cy', String(yGuide));
          guideDot.style.display = 'block';
        });
        rect.addEventListener('mouseleave', () => {
          guideLine.style.display = 'none';
          guideDot.style.display = 'none';
        });

        // --- クリック：音符を挿入
        rect.addEventListener('click', (e) => {
          const { x: localX, y: localY } =
            clientToGroup(svg, group as SVGGElement, (e as MouseEvent).clientX, (e as MouseEvent).clientY);

          const snappedLine = snapLineBySpacing(stave, localY);
          const key = lineToKeyTreble(snappedLine);

          // Xの挿入位置を決める
          let insertAt = safeEvents.length;
          let minDist = Infinity;

          if (vfNotes.length > 0) {
            const measLeft = xDraw;
            const measRight = xDraw + wDraw;

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

          // 拍オーバー防止しつつ反映
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
        x += w;
      }
    }
  }, [systems, gap, measuresPerSystem, score, tool, scale]);

  return <div ref={ref} />;
}

/* ===== VexFlowノート生成 ===== */
function makeVFNote(ev: NoteEvent) {
  const vfDur = toVFDur(ev.dur);
  if (ev.isRest) {
    const n = new StaveNote({ clef: 'treble', keys: ['b/4'], duration: (vfDur as VFDur) + 'r' });
    (n as any).setCenterAlignment?.(true);
    return n;
  }
  return new StaveNote({ clef: 'treble', keys: [ev.key], duration: vfDur });
}
