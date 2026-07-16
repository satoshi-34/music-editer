// src/utils/hairpinRenderUtils.ts
// 松葉（ヘアピン、クレッシェンド＜／ディミヌエンド＞）の SVG 描画ユーティリティ。
// StaffCanvas と PianoSystemCanvas の両方から使うため、描画ロジックを共通化する。

/** 松葉の最大開き幅（px）。五線下の強弱記号帯に収まる控えめなサイズにする */
export const HAIRPIN_HEIGHT = 11;

/** 松葉を五線下端からどれだけ下に描くか（強弱記号テキストと同じ高さ帯） */
export const HAIRPIN_Y_OFFSET = 22;

export interface HairpinSegmentParams {
  /** 描画先の SVG グループ要素 */
  svgRoot: SVGElement;
  /** 区間の左端X／右端X（SVG論理座標） */
  x1: number;
  x2: number;
  /** 松葉の中心線Y（開き幅はこのYを挟んで上下対称） */
  y: number;
  type: 'cresc' | 'dim';
  /**
   * 区間全体の中でこのセグメントが占める開き具合（0〜1）。
   * 段またぎで分割描画するとき、前半セグメントは 0〜0.5、後半は 0.5〜1 のように渡すと
   * 開き幅がつながって見える。単一セグメントなら 0〜1 を渡す。
   */
  fracStart: number;
  fracEnd: number;
  /** 選択中なら青でハイライトする */
  isSelected: boolean;
  /** クリック時コールバック（選択用）。省略時はクリック不可（pointer-events: none） */
  onClick?: (ev: MouseEvent) => void;
}

/**
 * 松葉の1セグメント（2本の直線）を描画する。
 * cresc は左が閉じて右へ開く（<）、dim は左が開いて右へ閉じる（>）。
 * fracStart / fracEnd で開き具合の範囲を指定できるため、段またぎの分割描画にも使える。
 */
export function drawHairpinSegment(params: HairpinSegmentParams): void {
  const { svgRoot, x1, x2, y, type, fracStart, fracEnd, isSelected, onClick } = params;
  const ns = 'http://www.w3.org/2000/svg';

  // 開き幅: cresc は進むほど開く（frac に比例）、dim は進むほど閉じる（1 - frac に比例）
  const openAt = (frac: number) => HAIRPIN_HEIGHT * (type === 'cresc' ? frac : 1 - frac);
  const o1 = openAt(fracStart);
  const o2 = openAt(fracEnd);

  const color = isSelected ? '#3b82f6' : '#1f2937';
  // 上下2本の線を1つの path にまとめる（クリック判定・ハイライトを1要素で扱えるようにする）
  const d = `M ${x1} ${y - o1 / 2} L ${x2} ${y - o2 / 2} M ${x1} ${y + o1 / 2} L ${x2} ${y + o2 / 2}`;

  // クリック判定用の太い透明パス（細い線だとクリックしづらいため）。
  // 注意: .score-area svg path のCSSが stroke-width を上書きし、pointer-events も
  // 祖先から none を継承するため、インラインstyle と明示的な pointer-events 指定で確実に勝たせる
  if (onClick) {
    const hit = document.createElementNS(ns, 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('pointer-events', 'stroke');
    // 印刷時に App.css の @media print が svg path を黒で強制するため、
    // このクラスを目印にして「透明なクリック判定用パス」だけは印刷から除外する
    hit.setAttribute('class', 'vf-hairpin-hit');
    hit.style.strokeWidth = '10';
    hit.style.cursor = 'pointer';
    hit.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(ev as MouseEvent); });
    svgRoot.appendChild(hit);
  }

  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.style.strokeWidth = isSelected ? '1.8' : '1.2';
  path.setAttribute('pointer-events', 'none');
  svgRoot.appendChild(path);
}
