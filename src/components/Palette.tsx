// src/components/Palette.tsx
// ─────────────────────────────────────────────────────────────
// 目的：ツールバーに「音符/休符」のアイコンを並べ、クリックで選択できる。
// 仕組み：VexFlowで1音だけ描画 → 実際の描画要素の合成BBoxから viewBox を作成
//         → ボタン枠に等比フィット。色は #111 で統一（白抜け防止）。
// ★調整点：FILL_TWEAKS で記号ごとの見た目サイズを微調整できます。
// 初学者向けにコメント多めに入れています。
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter } from 'vexflow';

// ========== 表示サイズ＆色（ボタン側と合わせる） ==========
const BUTTON_W = 56;   // ボタン幅（CSSと合わせる）
const BUTTON_H = 44;   // ボタン高さ（CSSと合わせる）

// ボタンの中に置くアイコン用 SVG の物理解像度
const CANVAS_W = 52;   // 横幅（ボタンより少しだけ小さめ）
const CANVAS_H = 40;   // 高さ（= ボタン高さの約9割）
const COLOR   = '#111';// 強制色（テーマに影響されない濃い黒）
const MIN_PAD = 1;     // 最低限の余白（食み出し防止の保険）
// ========================================================

// 取り扱う音価（全=1, 2=二分, 4=四分, 8=八分…）
export type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';

// VexFlowでの記法へ変換：'1→w', '2→h', '4→q', それ以外は同じ
export function normalizeToVF(d: DurKey): 'w'|'h'|'q'|'8'|'16'|'32'|'64' {
  return d==='1'?'w':d==='2'?'h':d==='4'?'q':d;
}

// ツール（「音価」と「休符かどうか」）
export type Tool = { duration: DurKey; isRest?: boolean };

// 並べるアイテム（上段=音符, 下段=休符）
const ROW1: Tool[] = ['1','2','4','8','16','32','64'].map(d => ({ duration: d as DurKey }));
const ROW2: Tool[] = ROW1.map(t => ({ ...t, isRest: true }));

// ─────────────────────────────────────────────────────────────
// ★ ここが“サイズ調整ダイヤル”です！
//    ・BASE_FILL … 全体の基準の大きさ（数値が小さいほど“見た目が小さく”なる）
//    ・FILL_TWEAKS … 記号別の上書き（なければ BASE_FILL が使われます）
//    ・キーの命名：音符 = 'w','h','q','8','16','32','64'
//                  休符 = 上記＋'r'（例：四分休符 'qr'、八分休符 '8r'）
// ─────────────────────────────────────────────────────────────
const BASE_FILL = 0.60; // だいたい“ボタン内の7〜8割”くらいの見た目

type SymKey =
  | 'w'|'h'|'q'|'8'|'16'|'32'|'64'
  | 'wr'|'hr'|'qr'|'8r'|'16r'|'32r'|'64r';

const FILL_TWEAKS: Partial<Record<SymKey, number>> = {
  // 例：全音符/全休符/二分休符は背が低く大きく見えがち → 小さめに
  w:  0.25,
  wr: 0.20,
  hr: 0.20,
  // ご要望：八分休符を小さく
  '8r': 0.40,
  // 32分・64分は小さく見えがち → ほんの少し大きめ
  '32':  0.75,
  '32r': 0.75,
  '64':  0.85,
  '64r': 0.85,
  // 必要に応じて追記どうぞ（例）
  // 'q': 0.72,   // 四分音符を少し小さく
  // 'qr': 0.70,  // 四分休符を少し小さく
  // '16r': 0.70, // 16分休符を少し小さく
};

// ─────────────────────────────────────────────────────────────

export default function Palette({
  value, onChange,
}: { value: Tool; onChange: (t: Tool) => void }) {

  const items = [...ROW1, ...ROW2]; // 7×2 = 14個

  return (
    <div
      className="palette-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7,56px)', // 7列分
        gap: 8,
        padding: 8,
      }}
    >
      {items.map((t, i) => {
        const active = value.duration === t.duration && !!value.isRest === !!t.isRest;
        return (
          <button
            key={i}
            onClick={() => onChange(t)}
            aria-label={`${t.isRest ? '休符' : '音符'} ${label(t.duration)}`}
            title={`${t.isRest ? '休符' : '音符'} ${label(t.duration)}`}
            style={{
              width: BUTTON_W,
              height: BUTTON_H,
              padding: 0,
              borderRadius: 10,
              border: active ? '2px solid #3b82f6' : '1px solid #ccc',
              background: '#fff',
              color: '#222',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <NoteIcon duration={t.duration} isRest={t.isRest} />
          </button>
        );
      })}
    </div>
  );
}

// ツールチップ用の日本語ラベル（“音符 4分”などに使う）
function label(d: DurKey) {
  return d==='1'?'全':d==='2'?'2分':d==='4'?'4分':d==='8'?'8分':d==='16'?'16分':d==='32'?'32分':'64分';
}

/**
 * 各ボタン内の“小さなSVG”に音符/休符を1つ描く（五線は描かない）。
 * 1) VexFlowで描画
 * 2) 実ストローク群（path/line/ellipse/polygon/rect）の合成BBoxを計算
 * 3) そのBBoxをベースに viewBox を作り、W×Hに等比フィット
 * 4) ただし FILL（記号別の占有率）に応じて viewBox を“広げて”小さくもできる
 */
function NoteIcon({ duration, isRest }: { duration: DurKey; isRest?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = ''; // 前回の描画をクリア

    try {
      // 1) SVGレンダラー
      const renderer = new Renderer(host, Renderer.Backends.SVG);
      renderer.resize(CANVAS_W, CANVAS_H);
      const ctx = renderer.getContext();

      // 2) レイアウト用 Stave（drawしない＝五線は出さない）
      const stave = new Stave(0, 0, CANVAS_W);
      (stave as any).setContext?.(ctx);

      // 3) 音符/休符の作成（休符は高さ非依存なので 'b/4' でOK）
      const vfCore = normalizeToVF(duration);        // 'w' | 'h' | 'q' | '8' | ...
      const vfDur: SymKey = (vfCore + (isRest ? 'r' : '')) as SymKey; // 例: '8' or '8r'
      const note = new StaveNote({
        clef: 'treble',
        keys: ['b/4'],
        duration: vfDur,
      });
      (note as any).setCenterAlignment?.(true);
      (note as any).setStave?.(stave);

      // 4) 1音の Voice を配置して描画
      const voice = new Voice({ time: { num_beats: 1, beat_value: 1 } } as any);
      voice.setMode((Voice as any).Mode.SOFT ?? 1);
      voice.addTickables([note]);
      new Formatter({ align_rests: true }).joinVoices([voice]).formatToStave([voice], stave);
      voice.draw(ctx, stave);

      // 5) SVG取得＆黒で強制（白抜け対策）※ rect も忘れずに！
      const svg = (ctx as any).svg as SVGSVGElement | undefined;
      if (!svg) return;
      svg.style.display = 'block';
      svg.querySelectorAll('path,line,ellipse,polygon,rect').forEach(el => {
        (el as SVGElement).setAttribute('stroke', COLOR);
        (el as SVGElement).setAttribute('fill', COLOR);
      });

      // 6) 実描画要素の合成BBox（rect含む）。無ければグループ全体でフォールバック
      const scope = (svg.querySelector('g.vf-stavenote') as SVGGElement | null) ?? svg;
      let shapes = Array.from(scope.querySelectorAll('path,line,ellipse,polygon,rect')) as SVGGraphicsElement[];
      if (shapes.length === 0) {
        const all = Array.from(svg.querySelectorAll('path,line,ellipse,polygon,rect')) as SVGGraphicsElement[];
        if (all.length > 0) shapes = all;
      }

      let baseW = 0, baseH = 0, minX = 0, minY = 0;
      if (shapes.length > 0) {
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (const s of shapes) {
          const b = s.getBBox();
          if (!isFinite(b.x) || !isFinite(b.y) || !isFinite(b.width) || !isFinite(b.height)) continue;
          minx = Math.min(minx, b.x);
          miny = Math.min(miny, b.y);
          maxx = Math.max(maxx, b.x + b.width);
          maxy = Math.max(maxy, b.y + b.height);
        }
        if (minx < Infinity) {
          minX = minx; minY = miny; baseW = maxx - minx; baseH = maxy - miny;
        }
      }
      if (baseW === 0 || baseH === 0) {
        const b = (scope as SVGGraphicsElement).getBBox?.();
        if (b && isFinite(b.width) && isFinite(b.height)) {
          minX = b.x; minY = b.y; baseW = b.width; baseH = b.height;
        }
      }

      // 7) 記号ごとの FILL（なければ BASE_FILL）を決定
      const fill = (FILL_TWEAKS[vfDur] ?? BASE_FILL);

      // 8) viewBox を“fillぶん”広げ、W×Hに等比フィット（=小さく/大きくを統一）
      if (baseW > 0 && baseH > 0) {
        const expand = 1 / Math.max(fill, 0.01);                 // FILLが小さいほど広くなる=表示は小さく
        const padX = Math.max((baseW * (expand - 1)) / 2, MIN_PAD);
        const padY = Math.max((baseH * (expand - 1)) / 2, MIN_PAD);

        const vbX = minX - padX;
        const vbY = minY - padY;
        const vbW = baseW + padX * 2;
        const vbH = baseH + padY * 2;

        svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.setAttribute('width', String(CANVAS_W));
        svg.setAttribute('height', String(CANVAS_H));
      }
    } catch {
      // 失敗しても真っ白にならないよう、Unicodeにフォールバック
      const fb = unicodeFallback(duration, !!isRest);
      host.textContent = fb;
      host.style.fontSize = '18px';
      host.style.lineHeight = '1';
      host.style.color = COLOR;
    }
  }, [duration, isRest]);

  // はみ出し防止にコンテナサイズも固定
  return <div ref={ref} style={{ width: CANVAS_W, height: CANVAS_H }} aria-hidden="true" />;
}

// 失敗時フォールバック（環境で字形は多少変わります）
function unicodeFallback(d: DurKey, rest: boolean) {
  if (rest) {
    return d==='1' ? '𝄻' : d==='2' ? '𝄺' : d==='4' ? '𝄽'
         : d==='8' ? '𝄼' : d==='16'? '𝄾' : d==='32'? '𝄿' : '𝅀';
  } else {
    return d==='1' ? '𝅝' : d==='2' ? '𝅗𝅥' : d==='4' ? '♩'
         : d==='8' ? '♪' : d==='16'? '𝅘𝅥𝅯' : d==='32'? '𝅘𝅥𝅰' : '𝅘𝅥𝅱';
  }
}
