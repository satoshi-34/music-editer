// src/components/StaffCanvas.tsx
import { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline, Beam } from 'vexflow';
import type { Tool } from './Palette';
import { normalizeToVF, type DurKey } from './Palette';

// 1小節分の音符や休符の配列
type Measure = { tickables: any[] };

// コンポーネントのProps
type Props = { systems?: number; gap?: number; measuresPerSystem?: number; tool: Tool; scale: number };

export default function StaffCanvas({ systems = 6, gap = 110, measuresPerSystem = 4, tool, scale = 1 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const [score, setScore] = useState<Measure[]>(
    Array.from({ length: systems * measuresPerSystem }, () => ({ tickables: [] }))
  );

  useEffect(() => {
    if (!ref.current) return;
    const container = ref.current;
    container.innerHTML = '';
    setScore(Array.from({ length: systems * measuresPerSystem }, () => ({ tickables: [] })));
  }, [systems, measuresPerSystem]);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';

    const W = ref.current.parentElement?.clientWidth ?? ref.current.clientWidth ?? 700;
    const top = 10, bottom = 30, H = top + systems * gap + bottom;

    const renderer = new Renderer(ref.current, Renderer.Backends.SVG);
    renderer.resize(W, H);
    const ctx = renderer.getContext();
    const svg = ref.current.querySelector('svg'); if (!svg) return;

    const left = 16, right = 16;
    const innerW = W - left - right;

    const CLEF_PAD_FIRST = 44;
    const CLEF_PAD_OTHER = 28;

    for (let s = 0; s < systems; s++) {
      const y = top + s * gap;
      const idx0 = s * measuresPerSystem;
      const idx1 = idx0 + measuresPerSystem;

      const CLEF_PAD_THIS = (s === 0) ? CLEF_PAD_FIRST : CLEF_PAD_OTHER;
      const allocW = innerW - CLEF_PAD_THIS;

      const weights: number[] = [];
      for (let i = idx0; i < idx1; i++) {
        const m = score[i];
        const w = m.tickables.length
          ? m.tickables.reduce((sum, n) => sum + (64 / denom((n.getDuration?.() ?? 'q').replace('r',''))), 0)
          : 16;
        weights.push(w);
      }
      const total = weights.reduce((a, b) => a + b, 0);
      const w0ratio = total > 0 ? (weights[0] / total) : (1 / measuresPerSystem);

      const firstContentW = allocW * w0ratio;
      const firstW        = firstContentW + CLEF_PAD_THIS;

      const restContentW  = allocW - firstContentW;
      const restWeightSum = total - (total > 0 ? weights[0] : 0);
      const fallbackRatio = 1 / Math.max(1, measuresPerSystem - 1);

      let x = left;
      for (let mi = 0; mi < measuresPerSystem; mi++) {
        const idx = idx0 + mi;

        const contentW = (mi === 0)
          ? firstContentW
          : restContentW * (restWeightSum > 0 ? (weights[mi] / restWeightSum) : fallbackRatio);

        const w = Math.max(20, contentW + (mi === 0 ? CLEF_PAD_THIS : 0));

        const stave = new Stave(x, y, w);
        if (mi === 0) {
          stave.addClef('treble');
          if (s === 0) stave.addTimeSignature('4/4');
        }
        stave.setEndBarType(Barline.type.SINGLE).setContext(ctx).draw();

        const notes = score[idx].tickables.length ? score[idx].tickables : [makeRest('1')];
        const beams = Beam.generateBeams(notes, { beam_rests: false, maintain_stem_directions: false });

        const v = new Voice({ time: { num_beats: 4, beat_value: 4 } } as any);
        v.setMode((Voice as any).Mode.SOFT ?? 1);
        v.addTickables(notes);

        new Formatter({ align_rests: true }).joinVoices([v]).formatToStave([v], stave);
        v.draw(ctx, stave);
        beams.forEach(b => b.setContext(ctx).draw());

        // === クリック領域 ===
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const rectY = stave.getYForLine(0);
        const rectH = stave.getYForLine(4) - rectY;
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(rectY));
        rect.setAttribute('width', String(w));
        rect.setAttribute('height', String(rectH));
        rect.setAttribute('fill', 'transparent');
        rect.setAttribute('pointer-events', 'all');
        rect.style.cursor = 'crosshair';

        // === クリック時の処理 ===
        rect.addEventListener('click', (e) => {
          const svgRect = (svg as SVGSVGElement).getBoundingClientRect();

          // X座標 → 挿入位置を決める
          const clickX = e.clientX - svgRect.left - x;

          // Y座標 → 高さ（音の上下）を決める
          const clickY = e.clientY - svgRect.top;
          const rawLine = stave.getLineForY(clickY);
          const line = Math.round(rawLine * 2) / 2; // 0.5刻みに丸める
          const key = vfLineToKeyTreble(line);

          setScore(old => {
            const next = old.map(m => ({ tickables: [...m.tickables] }));
            const m = next[idx];

            const current = sumBeats(m.tickables);
            const add = beatsFromVF(normalizeToVF(tool.duration as DurKey));
            if (current + add > 4) return old;

            const newNote = makeFromTool(tool, key);

            // X位置に基づいて挿入場所を決定
            let insertAt = m.tickables.length;
            for (let i = 0; i < m.tickables.length; i++) {
              const note = m.tickables[i] as any;
              if (note.getAbsoluteX) {
                const noteX = note.getAbsoluteX();
                if (clickX < noteX) {
                  insertAt = i;
                  break;
                }
              }
            }
            m.tickables.splice(insertAt, 0, newNote);
            return next;
          });
        });

        svg.appendChild(rect);
        x += w;
      }
    }
  }, [systems, gap, measuresPerSystem, score, tool, scale]);

  return <div ref={ref} />;
}

// ==== ヘルパー関数 ====

// VexFlowのline番号 → 音名に変換
function vfLineToKeyTreble(line: number): string {
  // line=0 → 五線の一番上の線(f/5)
  // line=4 → 五線の一番下の線(e/4)
  // 0.5刻みでスペースや加線
  const map: Record<number, string> = {
    0: 'f/5',
    0.5: 'e/5',
    1: 'd/5',
    1.5: 'c/5',
    2: 'b/4',
    2.5: 'a/4',
    3: 'g/4',
    3.5: 'f/4',
    4: 'e/4',
  };
  return map[line] ?? 'c/4';
}

function makeFromTool(tool: Tool, keyOverride?: string) {
  const vfDur = normalizeToVF(tool.duration as DurKey);
  if (tool.isRest) return makeRest(tool.duration);
  return new StaveNote({ clef: 'treble', keys: [keyOverride ?? 'e/4'], duration: vfDur });
}

function makeRest(dur: DurKey) {
  const vfDur = normalizeToVF(dur);
  const n = new StaveNote({ clef: 'treble', keys: ['b/4'], duration: vfDur + 'r' });
  (n as any).setCenterAlignment?.(true);
  return n;
}

function beatsFromVF(vf: 'w'|'h'|'q'|'8'|'16'|'32'|'64') {
  return vf==='64'?1/16:vf==='32'?1/8:vf==='16'?1/4:vf==='8'?1/2:vf==='q'?1:vf==='h'?2:4;
}

function sumBeats(tickables: any[]) {
  return tickables.reduce((s, n) => s + beatsFromVF((n.getDuration?.() ?? 'q').replace('r','') as any), 0);
}

function denom(vf: string) { return vf==='64'?64:vf==='32'?32:vf==='16'?16:vf==='8'?8:vf==='q'?4:vf==='h'?2:1; }
