// src/components/StaffCanvas.tsx
// 目的：小節の“内容量（音価）”に応じて小節幅を可変にするデモ実装。
// ポイント：
//  1) 小節ごとに Voice を作る（Voice の使い回し厳禁）
//  2) Formatter.preCalculateMinTotalWidth で「必要最小幅」を出す
//  3) 段の実効幅に対して、余り幅を“最小幅の比率”で配分
//  4) 確定した幅の Stave に対して formatToStave → draw の順で描く
//
// これにより「音価が多い小節は広く、少ない小節は狭く」自然な詰め具合になる。

import { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline } from 'vexflow';

type Props = {
  note: string;               // デモ用：1音を使い回す（実装では小節ごとに別データを流し込む想定）
  systems?: number;           // 何段描くか（縦方向の段数）
  gap?: number;               // 段間の縦ピクセル
  measuresPerSystem?: number; // 1段あたりの小節数
};

const StaffCanvas = ({
  note,
  systems = 6,
  gap = 110,
  measuresPerSystem = 4,
}: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = ''; // 先にクリア（再描画対策）

    // ===== ① キャンバスサイズ算出 =====
    // clientWidth が 0 になるタイミング対策として親要素 or デフォルトにフォールバック
    const W =
      containerRef.current.clientWidth ||
      containerRef.current.parentElement?.clientWidth ||
      700;
    const H = systems * gap + 20; // 段数×段間からざっくり高さを見積もる

    // ===== ② VexFlow レンダラ準備 =====
    const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG);
    renderer.resize(W, H);
    const context = renderer.getContext();
    context.setFont('Times', 10, '').setBackgroundFillStyle('#fff');

    // ===== ③ 段の左右マージンと実効幅 =====
    const leftMargin = 16;
    const rightMargin = 16;
    const systemInnerWidth = W - leftMargin - rightMargin; // この幅に収める

    // ===== ④ UI入力の音名を VexFlow キーへ変換（例: "C4" → "c/5"）=====
    const m = note.match(/^([A-Ga-g])([0-9])$/);
    if (!m) return;
    const [, pitch, oct] = m;
    const key = `${pitch.toLowerCase()}/${Number(oct) + 1}`;

    // ===== ⑤ 段描画ループ =====
    for (let s = 0; s < systems; s++) {
      const y = 10 + s * gap; // 段の縦位置
      let x = leftMargin;     // その段の左端から開始

      // ---- (A) 小節ごとに Voice を準備 ----
      // ここが“内容量”を反映させる肝。実装では measure ごとに別の音符配列を渡す。
      const voicesPerMeasure: Voice[] = [];
      for (let mi = 0; mi < measuresPerSystem; mi++) {
        let notes: StaveNote[] = [];

        // デモ：2小節目は八分×8、3小節目は16分×16、他は四分×4
        // → 内容量が多い小節ほど必要最小幅が大きくなる
        if (mi === 1) {
          notes = Array.from({ length: 8 }, () =>
            new StaveNote({ keys: [key], duration: '8', clef: 'treble' })
          );
        } else if (mi === 2) {
          notes = Array.from({ length: 16 }, () =>
            new StaveNote({ keys: [key], duration: '16', clef: 'treble' })
          );
        } else {
          notes = Array.from({ length: 4 }, () =>
            new StaveNote({ keys: [key], duration: 'q', clef: 'treble' })
          );
        }

        // 小節ごとに新しい Voice を作成（※使い回しNG）
        const v = new Voice({ num_beats: 4, beat_value: 4 } as any);
        v.setStrict(true);    // 音価合計不一致を検知
        v.addTickables(notes);
        voicesPerMeasure.push(v);
      }

      // ---- (B) 必要最小幅 → 段幅にフィットさせる配分計算 ----
      // preCalculateMinTotalWidth: その Voice を並べるのに必要な“最小”の描画幅
      // ※ ここでは小節左右にパディングを足して見た目を整える
      const perMeasurePadding = 8; // 小節の左右余白（先頭だけ増やすなら mi===0 条件で調整）
      const mins = voicesPerMeasure.map(
        (v) => Formatter.preCalculateMinTotalWidth([v]) + perMeasurePadding * 2
      );
      const totalMin = mins.reduce((a, b) => a + b, 0);

      // 段実効幅に対して
      //  - 余白があれば“最小幅に比例”して配分（＝内容量が多い小節に多めに配る）
      //  - 余ってなければ等比縮小して全体を収める
      let widths: number[];
      if (totalMin <= systemInnerWidth) {
        const slack = systemInnerWidth - totalMin;
        widths = mins.map((w) => w + (slack * w) / totalMin);
      } else {
        const scale = systemInnerWidth / totalMin;
        widths = mins.map((w) => w * scale);
      }

      // ---- (C) 描画：確定した幅で各小節を描く ----
      for (let mi = 0; mi < measuresPerSystem; mi++) {
        const w = Math.max(1, widths[mi]); // 念のため幅の0/負をガード
        const stave = new Stave(x, y, w);

        // 段頭の最初の小節にだけ記号を付与（formatToStave が占有幅を考慮してくれる）
        if (s === 0 && mi === 0) {
          stave.addClef('treble').addTimeSignature('4/4');
        }
        // 終端の小節線（必要に応じて DOUBLE / END などに変更可能）
        stave.setEndBarType(Barline.type.SINGLE);

        stave.setContext(context).draw();

        // 小節ごとに formatToStave：stave の開始位置・記号幅を考慮して整列
        new Formatter()
          .joinVoices([voicesPerMeasure[mi]])
          .formatToStave([voicesPerMeasure[mi]], stave);

        // 音符の描画
        voicesPerMeasure[mi].draw(context, stave);

        // 次小節の X へ
        x += w;

        // 親幅が極端に狭い時の安全弁（右端を超えたら打ち切り）
        if (x > W - rightMargin - 10) break;
      }
    }
  }, [note, systems, gap, measuresPerSystem]);

  // SVG を描く受け皿
  return <div ref={containerRef} />;
};

export default StaffCanvas;
