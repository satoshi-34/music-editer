import { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline, Beam } from 'vexflow';
import type { Tool } from './Palette';
import { normalizeToVF, type DurKey } from './Palette';

// ==== 型 ====
type Measure = { tickables: any[] };

type Props = {
  systems?: number;             // 何行描くか（固定行数）
  gap?: number;                 // 行の縦間隔(px)
  measuresPerSystem?: number;   // 目標値（初期4）。入り切らなければ 4→3→2→1 に自動で落とす
  tool: Tool;                   // クリックで置くツール
  scale: number;                // ページの拡縮（ここでは再描画トリガにだけ使う）
};

// ===== 見た目/レイアウトのパラメータ =====
const TARGET_FILL = 0.90;         // 行の内側幅の 90% を使う（＝中央寄せしつつ余白を残す）
const MIN_MEASURE_W = 40;         // 小節の最低幅（詰まり過ぎ防止）
const CLEF_PAD_FIRST = 44;        // 1段目の行頭に足すパディング（ト音＋拍子）
const CLEF_PAD_OTHER = 28;        // 2段目以降の行頭に足すパディング（ト音）
const NOTEBOX_FALLBACK_W = 16;    // 空小節の重み（重みが0だと割り切れないため）

export default function StaffCanvas({
  systems = 6,
  gap = 110,
  measuresPerSystem = 4,
  tool,
  scale = 1,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // 初期は systems × measuresPerSystem 小節ぶん確保
  const [score, setScore] = useState<Measure[]>(
    Array.from({ length: systems * measuresPerSystem }, () => ({ tickables: [] }))
  );

  // 行数 or 1行あたり小節数が変わったら配列を作り直し
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';
    setScore(Array.from({ length: systems * measuresPerSystem }, () => ({ tickables: [] })));
  }, [systems, measuresPerSystem]);

  // ====== メイン描画 ======
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';

    // キャンバスサイズ計算
    const W = ref.current.parentElement?.clientWidth ?? ref.current.clientWidth ?? 700;
    const top = 10, bottom = 30, H = top + systems * gap + bottom;

    // VexFlow レンダラ
    const renderer = new Renderer(ref.current, Renderer.Backends.SVG);
    renderer.resize(W, H);
    const ctx = renderer.getContext();
    const svg = ref.current.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;

    // 外側左右マージン
    const left = 16, right = 16;
    const innerW = W - left - right;

    // 小節を上から順に配置していくカーソル
    let globalMeasureIndex = 0;

    // 1行ずつ描画
    for (let s = 0; s < systems; s++) {
      const y = top + s * gap;

      // ====== この行に何小節置ける？（4→3→2→1 の順に試す）=====
      // 目標は measuresPerSystem だが、内容が多すぎる場合は自動で落とす
      let chosenCount = 1;
      let widthsForChosen: number[] = [];
      let startXForChosen = left; // 中央寄せ用

      // この行の記号パディング
      const CLEF_PAD_THIS = (s === 0) ? CLEF_PAD_FIRST : CLEF_PAD_OTHER;

      // 試行関数：n 小節入れたときの各幅と開始Xを返す。入らなければ null。
      const tryFit = (n: number): { widths: number[]; startX: number } | null => {
        // 残り小節が足りなければ縮める（超安全）
        const last = Math.min(globalMeasureIndex + n, score.length);

        // 内容に基づく重み（細かい音価ほど重い＝広くしたい）
        const weights: number[] = [];
        for (let i = globalMeasureIndex; i < last; i++) {
          const m = score[i];
          const w = (m && m.tickables.length)
            ? m.tickables.reduce((sum, n) => sum + (64 / denom((n.getDuration?.() ?? 'q').replace('r',''))), 0)
            : NOTEBOX_FALLBACK_W;
          weights.push(Math.max(1, w));
        }
        // 足りないぶんを“空小節”として埋める
        while (weights.length < n) weights.push(NOTEBOX_FALLBACK_W);

        const totalWeight = weights.reduce((a, b) => a + b, 0);

        // 行の“使用可能幅”：内側幅 * 90%
        const occupy = innerW * TARGET_FILL;

        // 行頭小節に加えるパディング分は先に確保
        const allocContentW = Math.max(0, occupy - CLEF_PAD_THIS);

        // まずは重みで按分（比率配分）
        const contentWidths = weights.map(w => Math.max(MIN_MEASURE_W, allocContentW * (w / totalWeight)));

        // “加重合計”が allocContentW を超えた場合はそのまま（縮小しない）
        let sumContent = contentWidths.reduce((a, b) => a + b, 0);

        // 開始X（中央寄せ）：occupy を使うので左右に( innerW - occupy )/2 の余白
        const startX = left + (innerW - occupy) / 2;

        // 実際の小節幅：先頭だけ CLEF_PAD_THIS を上乗せ
        const realWidths = contentWidths.map((w, i) => (i === 0 ? w + CLEF_PAD_THIS : w));

        // 入るかどうかの判定：realWidths の合計が occupy を少しでも超えるなら NG
        const need = realWidths.reduce((a, b) => a + b, 0);
        if (need > occupy * 1.001) return null;

        return { widths: realWidths, startX };
      };

      // 目標値→3→2→1 の順にフィットを試す
      const candidates = [measuresPerSystem, 3, 2, 1].filter((v, i, arr) => arr.indexOf(v) === i);
      for (const n of candidates) {
        const fitted = tryFit(n);
        if (fitted) {
          chosenCount = n;
          widthsForChosen = fitted.widths;
          startXForChosen = fitted.startX;
          break;
        }
      }

      // ====== 実描画 ======

      // この行のレンダリング開始 X（中央寄せ）
      let x = startXForChosen;

      for (let mi = 0; mi < chosenCount; mi++) {
        const idx = globalMeasureIndex + mi;
        const w = widthsForChosen[mi] ?? (innerW * TARGET_FILL / chosenCount);

        // 小節の Stave を生成（VexFlowに任せる：縦線の高さは自動で一致）
        const stave = new Stave(x, y, w);

        // 行頭の1小節目だけ記号を描く
        if (mi === 0) {
          stave.addClef('treble');
          if (s === 0) stave.addTimeSignature('4/4');
        }
        // 終端バーライン：標準
        stave.setEndBarType(Barline.type.SINGLE);
        stave.setContext(ctx).draw();

        // ノート／休符（空なら全休符）
        const notes = (score[idx]?.tickables?.length ? score[idx].tickables : [makeRest('1')]);
        const beams = Beam.generateBeams(notes, { beam_rests: false, maintain_stem_directions: false });

        const v = new Voice({ time: { num_beats: 4, beat_value: 4 } } as any);
        v.setMode((Voice as any).Mode.SOFT ?? 1);
        v.addTickables(notes);

        // 休符の水平位置は揃えたいので align_rests: true（垂直位置はVexFlowのデフォ）
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

        rect.addEventListener('click', (e) => {
          const svgRect = (svg as SVGSVGElement).getBoundingClientRect();
          const clickX = (e as MouseEvent).clientX - svgRect.left - x; // 小節内基準
          const clickY = (e as MouseEvent).clientY - svgRect.top;

          // クリックY→五線上の line(0.5刻み)
          const rawLine = stave.getLineForY(clickY);
          const line = Math.round(rawLine * 2) / 2;
          const key = vfLineToKeyTreble(line);

          setScore(old => {
            const next = old.map(m => ({ tickables: [...m.tickables] }));
            // 小節が存在しない場合に備えて確保
            while (idx >= next.length) next.push({ tickables: [] });

            const m = next[idx];
            const current = sumBeats(m.tickables);
            const add = beatsFromVF(normalizeToVF(tool.duration as DurKey));
            if (current + add > 4) return old;

            const newNote = makeFromTool(tool, key);

            // === クリック位置に“最も近い”位置へ挿入 ===
            let insertAt = m.tickables.length;
            let minDist = Infinity;

            for (let i = 0; i < m.tickables.length; i++) {
              const note = m.tickables[i] as any;
              const absX = note.getAbsoluteX ? note.getAbsoluteX() - x : i * 20;
              const bb = note.getBoundingBox?.();
              const leftX = absX;
              const rightX = absX + (bb ? bb.getW() : 20);

              // 左側候補
              if (clickX < leftX) {
                const d = leftX - clickX;
                if (d < minDist) { minDist = d; insertAt = i; }
              }
              // 右側候補
              if (clickX > rightX) {
                const d = clickX - rightX;
                if (d < minDist) { minDist = d; insertAt = i + 1; }
              }
            }

            m.tickables.splice(insertAt, 0, newNote);
            return next;
          });
        });

        svg.appendChild(rect);
        x += w;
      }

      // 次の行へ
      globalMeasureIndex += chosenCount;
    }
  }, [systems, gap, measuresPerSystem, score, tool, scale]);

  return <div ref={ref} />;
}

// ==== ヘルパー関数 ====

function vfLineToKeyTreble(line: number): string {
  // VexFlow の line → 音名マップ（0=最上線, 4=最下線）
  // クリック感に寄せて、代表値をマップ。外れ値は c/4 にフォールバック。
  const map: Record<number, string> = {
    0: 'f/5', 0.5: 'e/5', 1: 'd/5', 1.5: 'c/5',
    2: 'b/4', 2.5: 'a/4', 3: 'g/4', 3.5: 'f/4', 4: 'e/4',
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
  // 休符を小節中央に寄せる（垂直位置はVexFlowデフォルト）
  (n as any).setCenterAlignment?.(true);
  return n;
}

function beatsFromVF(vf: 'w'|'h'|'q'|'8'|'16'|'32'|'64') {
  return vf==='64'?1/16:vf==='32'?1/8:vf==='16'?1/4:vf==='8'?1/2:vf==='q'?1:vf==='h'?2:4;
}

function sumBeats(tickables: any[]) {
  return tickables.reduce((s, n) => s + beatsFromVF((n.getDuration?.() ?? 'q').replace('r','') as any), 0);
}

function denom(vf: string) {
  return vf==='64'?64:vf==='32'?32:vf==='16'?16:vf==='8'?8:vf==='q'?4:vf==='h'?2:1;
}
