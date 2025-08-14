// src/components/StaffCanvas.tsx
import { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline, Beam } from 'vexflow';
import type { Tool } from './Palette';
import { normalizeToVF, type DurKey } from './Palette';

type Measure = { tickables: any[] };
type Props = { systems?: number; gap?: number; measuresPerSystem?: number; tool: Tool };

export default function StaffCanvas({ systems = 6, gap = 110, measuresPerSystem = 4, tool }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState<Measure[]>(
    Array.from({ length: systems * measuresPerSystem }, () => ({ tickables: [] }))
  );

  useEffect(() => {
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
    // innerW は「段の描画可能幅」。ここから記号ぶんを除いた幅を配分する
    const innerW = W - left - right;
    const CLEF_PAD_FIRST = 44; //１段目：ト音記号＋拍子
    const CLEF_PAD_OTHER = 28; //２段目以降：ト音記号のみ

    for (let s = 0; s < systems; s++) {
      const y = top + s * gap;
      const idx0 = s * measuresPerSystem;
      const idx1 = idx0 + measuresPerSystem;

      const CLEF_PAD_THIS = (s === 0) ? CLEF_PAD_FIRST : CLEF_PAD_OTHER;
      const allocW = innerW - CLEF_PAD_THIS;

      // 可変小節幅：短い音が多いほど広げる
      const weights: number[] = [];
      for (let i = idx0; i < idx1; i++) {
        const m = score[i];
        const w = m.tickables.length
          ? m.tickables.reduce((sum, n) => sum + (64 / denom((n.getDuration?.() ?? 'q').replace('r',''))), 0)
          : 16; // 空小節の最低ウェイト
        weights.push(w);
      }
      const total = weights.reduce((a, b) => a + b, 0);
      // ゼロ除算対策：全部空なら等分
      const w0ratio = total > 0 ? (weights[0] / total) : (1 / measuresPerSystem);

      // 段頭の小節は「内容分」 + CLEF_PAD を与える（← 掛け算！）
      const firstContentW = allocW * w0ratio;
      const firstW        = firstContentW + CLEF_PAD_THIS;

      // 残り小節に配分する内容分の幅
      const restContentW  = allocW - firstContentW;
      const restWeightSum = total - (total > 0 ? weights[0] : 0);
      const fallbackRatio = 1 / Math.max(1, measuresPerSystem - 1);

      let x = left;
      for (let mi = 0; mi < measuresPerSystem; mi++) {
        const idx = idx0 + mi; // ← これが必須！

        // mi=0 は段頭、その他は重みに応じて配分
        const contentW = (mi === 0)
          ? firstContentW
          : restContentW * (restWeightSum > 0 ? (weights[mi] / restWeightSum) : fallbackRatio);

        // 実際の小節幅（段頭だけ CLEF_PAD を足す）＋極小幅ガード、詰まる時は16~24で変える
        const w = Math.max(20, contentW + (mi === 0 ? CLEF_PAD_THIS : 0));

        const stave = new Stave(x, y, w);
        if (mi === 0) {
          stave.addClef('treble');
          if (s === 0){
            stave.addTimeSignature('4/4');
          }
        } 
        stave.setEndBarType(Barline.type.SINGLE).setContext(ctx).draw();

        // 空なら全休符の仮表示（'1' → normalizeToVF で全音符になる）
        const notes = score[idx].tickables.length ? score[idx].tickables : [makeRest('1')];

        // 連桁（8分以下を自動ビーム）
        const beams = Beam.generateBeams(notes, { beam_rests: false, maintain_stem_directions: false});

        const v = new Voice({ time: { num_beats: 4, beat_value: 4 } } as any);
        v.setMode((Voice as any).Mode.SOFT ?? 1);
        v.addTickables(notes);

        new Formatter({ align_rests: true }).joinVoices([v]).formatToStave([v], stave);
        v.draw(ctx, stave);
        beams.forEach(b => b.setContext(ctx).draw());

        // クリックで「合計4拍まで」積み増し
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

        rect.addEventListener('click', (e) => {
          const svgRect = (svg as SVGSVGElement).getBoundingClientRect();
          const line = Math.round(stave.getLineForY(e.clientY - svgRect.top) * 2) / 2;
          const key = lineToKeyTreble(line);

          setScore(old => {
            const next = old.map(m => ({ tickables: [...m.tickables] }));
            const m = next[idx];
            const current = sumBeats(m.tickables);
            const add = beatsFromVF(normalizeToVF(tool.duration as DurKey));
            if (current + add <= 4) m.tickables.push(makeFromTool(tool, key));
            return next;
          });
        });

       svg.appendChild(rect);
        x += w;
      }
    }
  }, [systems, gap, measuresPerSystem, score, tool]);

  return <div ref={ref} />;
}

// ---- helpers
function makeFromTool(tool: Tool, keyOverride?: string) {
  const vfDur = normalizeToVF(tool.duration as DurKey);
  if (tool.isRest) return makeRest(tool.duration);
  return new StaveNote({ clef: 'treble', keys: [keyOverride ?? 'e/4'], duration: vfDur });
}

function makeRest(dur: Tool['duration'] | 'w'|'h'|'q') {
  const vfDur = normalizeToVF((dur as any) as DurKey);
  const n = new StaveNote({ clef: 'treble', keys: ['b/4'], duration: vfDur + 'r' });
  (n as any).setCenterAlignment?.(true);
  return n;
}

// 拍換算（4分=1拍）
function beatsFromVF(vf: 'w'|'h'|'q'|'8'|'16'|'32'|'64') {
  return vf==='64'?1/16:vf==='32'?1/8:vf==='16'?1/4:vf==='8'?1/2:vf==='q'?1:vf==='h'?2:4;
}
function sumBeats(tickables: any[]) {
  return tickables.reduce((s, n) => s + beatsFromVF((n.getDuration?.() ?? 'q').replace('r','') as any), 0);
}

// 可変幅用：分母取得
function denom(vf: string) { return vf==='64'?64:vf==='32'?32:vf==='16'?16:vf==='8'?8:vf==='q'?4:vf==='h'?2:1; }

function lineToKeyTreble(line: number): string {
  const map = ['a/6','g/6','f/6','e/6','d/6','c/6','b/5','a/5','g/5','f/5','e/5','d/5','c/5','b/4','a/4','g/4','f/4','e/4','d/4','c/4','b/3','a/3','g/3','f/3','e/3','d/3','c/3','b/2','a/2'];
  const zero = map.indexOf('f/5');
  const idx = Math.max(0, Math.min(map.length - 1, zero + Math.round(line * 2)));
  return map[idx];
}
