// src/components/StaffCanvas.tsx
import { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline, Beam } from 'vexflow';
import type { Tool } from './Palette';
import { normalizeToVF, type DurKey } from './Palette';

// Measure型は1小節分の音符や休符の配列を持つ
// tickables: 小節内の音符や休符の情報を格納する配列
// Measure型は楽譜データの基本単位
// 例: { tickables: [音符1, 音符2, ...] }
type Measure = { tickables: any[] };

// Props型はコンポーネントに渡される設定やツール情報を定義
// systems: 五線譜の段数 (デフォルトは6段)
// gap: 段間の間隔 (デフォルトは110px)
// measuresPerSystem: 1段あたりの小節数 (デフォルトは4小節)
// tool: 現在選択されているツール情報
type Props = { systems?: number; gap?: number; measuresPerSystem?: number; tool: Tool };

// 五線譜を描画するコンポーネント
// 楽譜データを管理し、VexFlowを使ってSVG形式で描画
export default function StaffCanvas({ systems = 6, gap = 110, measuresPerSystem = 4, tool }: Props) {
  // 五線譜を描画するdiv要素への参照
  const ref = useRef<HTMLDivElement>(null);

  // 楽譜データ（各小節の音符・休符情報）
  // 初期状態では空の小節を生成
  const [score, setScore] = useState<Measure[]>(
    Array.from({ length: systems * measuresPerSystem }, () => ({ tickables: [] }))
  );

  // 段数や小節数が変わったとき、楽譜データを初期化
  useEffect(() => {
    if (!ref.current) return; // DOM要素がまだ存在しない場合は何もしない
    const container = ref.current;
    container.innerHTML = ''; // 前回の描画をクリア

    // 新しい段数と小節数に基づいて楽譜データを初期化
    setScore(Array.from({ length: systems * measuresPerSystem }, () => ({ tickables: [] })));
  }, [systems, measuresPerSystem]);

  // 楽譜データやツールが変わったら五線譜を再描画
  useEffect(() => {
    if (!ref.current) return; // DOM要素がまだ存在しない場合は何もしない
    ref.current.innerHTML = ''; // 前回の描画をクリア

    // 親要素の幅を取得（なければ700px）
    const W = ref.current.parentElement?.clientWidth ?? ref.current.clientWidth ?? 700;
    // 五線譜の上下余白
    const top = 10, bottom = 30, H = top + systems * gap + bottom;

    // VexFlowの描画準備
    const renderer = new Renderer(ref.current, Renderer.Backends.SVG); // SVG形式で描画
    renderer.resize(W, H); // 描画領域のサイズを設定
    const ctx = renderer.getContext(); // 描画コンテキストを取得
    const svg = ref.current.querySelector('svg'); if (!svg) return; // SVG要素が取得できなければ終了

    // 左右の余白
    const left = 16, right = 16;
    // 段の描画可能幅
    const innerW = W - left - right;
    // 段の最初の小節の記号分の余白
    const CLEF_PAD_FIRST = 44; // 1段目: ト音記号＋拍子
    const CLEF_PAD_OTHER = 28; // 2段目以降: ト音記号のみ

    // 段ごとに描画
    for (let s = 0; s < systems; s++) {
      const y = top + s * gap; // 段の縦位置
      const idx0 = s * measuresPerSystem; // この段の最初の小節インデックス
      const idx1 = idx0 + measuresPerSystem; // この段の最後の小節インデックス

      const CLEF_PAD_THIS = (s === 0) ? CLEF_PAD_FIRST : CLEF_PAD_OTHER;
      const allocW = innerW - CLEF_PAD_THIS; // 記号分を除いた幅

      // 小節ごとの「重み」を計算（短い音符が多いほど広くする）
      const weights: number[] = [];
      for (let i = idx0; i < idx1; i++) {
        const m = score[i];
        // 音符があればその分、なければ最低値
        const w = m.tickables.length
          ? m.tickables.reduce((sum, n) => sum + (64 / denom((n.getDuration?.() ?? 'q').replace('r',''))), 0)
          : 16; // 空小節の最低ウェイト
        weights.push(w);
      }
      const total = weights.reduce((a, b) => a + b, 0); // 重みの合計
      // 全部空なら等分
      const w0ratio = total > 0 ? (weights[0] / total) : (1 / measuresPerSystem);

      // 段頭小節の幅（内容分＋記号分）
      const firstContentW = allocW * w0ratio;
      const firstW        = firstContentW + CLEF_PAD_THIS;

      // 残り小節の幅を配分
      const restContentW  = allocW - firstContentW;
      const restWeightSum = total - (total > 0 ? weights[0] : 0);
      const fallbackRatio = 1 / Math.max(1, measuresPerSystem - 1);

      let x = left; // 小節の描画開始位置
      for (let mi = 0; mi < measuresPerSystem; mi++) {
        const idx = idx0 + mi; // 小節インデックス

        // 小節幅の計算
        const contentW = (mi === 0)
          ? firstContentW
          : restContentW * (restWeightSum > 0 ? (weights[mi] / restWeightSum) : fallbackRatio);

        // 実際の小節幅（段頭だけ記号分を足す）
        const w = Math.max(20, contentW + (mi === 0 ? CLEF_PAD_THIS : 0));

        // 五線を描画
        const stave = new Stave(x, y, w);
        if (mi === 0) {
          stave.addClef('treble'); // 段頭にト音記号
          if (s === 0){
            stave.addTimeSignature('4/4'); // 1段目だけ拍子記号
          }
        } 
        stave.setEndBarType(Barline.type.SINGLE).setContext(ctx).draw();

        // 音符がなければ全休符を仮表示
        const notes = score[idx].tickables.length ? score[idx].tickables : [makeRest('1')];

        // 8分音符以下は自動で連桁
        const beams = Beam.generateBeams(notes, { beam_rests: false, maintain_stem_directions: false});

        // Voice（拍子情報付きの音符グループ）を作成
        const v = new Voice({ time: { num_beats: 4, beat_value: 4 } } as any);
        v.setMode((Voice as any).Mode.SOFT ?? 1); // SOFTモードで拍数超過を許容
        v.addTickables(notes);

        // 小節内で音符を整列
        new Formatter({ align_rests: true }).joinVoices([v]).formatToStave([v], stave);
        v.draw(ctx, stave); // 音符描画
        beams.forEach(b => b.setContext(ctx).draw()); // 連桁描画

        // 小節クリック用の透明なrectを配置
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const rectY = stave.getYForLine(0); // 五線の上端
        const rectH = stave.getYForLine(4) - rectY; // 五線の高さ
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(rectY));
        rect.setAttribute('width', String(w));
        rect.setAttribute('height', String(rectH));
        rect.setAttribute('fill', 'transparent');
        rect.setAttribute('pointer-events', 'all');
        rect.style.cursor = 'crosshair';

        // 小節をクリックしたときの処理
        rect.addEventListener('click', (e) => {
          // クリック位置から五線の高さを計算
          const svgRect = (svg as SVGSVGElement).getBoundingClientRect();
          const line = Math.round(stave.getLineForY(e.clientY - svgRect.top) * 2) / 2;
          // クリック位置に対応する音名を取得
          const key = lineToKeyTreble(line);

          // 楽譜データを更新（4拍まで追加可能）
          setScore(old => {
            // 配列をコピー（Reactの状態管理のため）
            const next = old.map(m => ({ tickables: [...m.tickables] }));
            const m = next[idx];
            const current = sumBeats(m.tickables); // 現在の合計拍数
            const add = beatsFromVF(normalizeToVF(tool.duration as DurKey)); // 追加する音符の拍数
            if (current + add <= 4) m.tickables.push(makeFromTool(tool, key)); // 4拍以内なら追加
            return next;
          });
        });

        // rectをSVGに追加
        svg.appendChild(rect);
        x += w; // 次の小節位置へ
      }
    }
  }, [systems, gap, measuresPerSystem, score, tool]);

  // 五線譜描画用のdiv
  return <div ref={ref} />;
}

// ---- helpers

// ツール情報からVexFlow音符/休符を生成
function makeFromTool(tool: Tool, keyOverride?: string) {
  const vfDur = normalizeToVF(tool.duration as DurKey); // ツールの音価をVexFlow形式に変換
  if (tool.isRest) return makeRest(tool.duration); // 休符なら休符生成
  // 音符なら指定された高さで生成
  return new StaveNote({ clef: 'treble', keys: [keyOverride ?? 'e/4'], duration: vfDur });
}

// 指定した音価の休符を生成
function makeRest(dur: DurKey) {
  const vfDur = normalizeToVF(dur); // 音価をVexFlow形式に変換
  const n = new StaveNote({ clef: 'treble', keys: ['b/4'], duration: vfDur + 'r' }); // 休符
  (n as any).setCenterAlignment?.(true); // 休符を中央揃え
  return n;
}

// VexFlow音価から拍数を計算（例: 'q'→1拍, 'h'→2拍）
function beatsFromVF(vf: 'w'|'h'|'q'|'8'|'16'|'32'|'64') {
  return vf==='64'?1/16:vf==='32'?1/8:vf==='16'?1/4:vf==='8'?1/2:vf==='q'?1:vf==='h'?2:4;
}

// tickables配列の合計拍数を計算
function sumBeats(tickables: any[]) {
  return tickables.reduce((s, n) => s + beatsFromVF((n.getDuration?.() ?? 'q').replace('r','') as any), 0);
}

// VexFlow音価から分母を取得（幅計算用）
function denom(vf: string) { return vf==='64'?64:vf==='32'?32:vf==='16'?16:vf==='8'?8:vf==='q'?4:vf==='h'?2:1; }

// 五線のライン番号から音名（例: e/4, f/5など）を取得
function lineToKeyTreble(line: number): string {
  // ト音記号の五線対応表
  const map = ['a/6','g/6','f/6','e/6','d/6','c/6','b/5','a/5','g/5','f/5','e/5','d/5','c/5','b/4','a/4','g/4','f/4','e/4','d/4','c/4','b/3','a/3','g/3','f/3','e/3','d/3','c/3','b/2','a/2'];
  const zero = map.indexOf('f/5'); // 五線の中央
  // クリック位置から最も近い音名を取得
  const idx = Math.max(0, Math.min(map.length - 1, zero + Math.round(line * 2)));
  return map[idx];
}
