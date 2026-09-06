// src/editor/dragSessions/svgTiePreview.ts
// svg 全体に付けるドラッグ関連のリスナ: ドラッグ直後の click の読み飛ばし（capture）、背景クリックでの弧の選択解除、
// タイ／松葉の新規ドラッグの破線プレビュー（mousemove）と後始末（mouseup）。
// PianoSystemCanvas の描画 effect から物理移設（#695 段6c-2・挙動ゼロ差）。
import { computeArcGeometry } from '../../components/arcUtils';
import { clientToGroup } from '../hitResolution';
import type { SelectionContext } from '../types';
import type { TiePreviewContext } from './types';

export interface SvgDragListenerDeps extends TiePreviewContext {
  setSelectedArc: SelectionContext['setSelectedArc'];
  setSelectedHairpin: SelectionContext['setSelectedHairpin'];
}

/** svg にドラッグ関連のリスナを付ける（svg は effect ごとに作り直されるので解除は不要） */
export function attachSvgDragListeners(deps: SvgDragListenerDeps): void {
  const { svg, svgRoot, dragSessionsRef, tiePreviewPath, tool, setSelectedArc, setSelectedHairpin } = deps;
// ドラッグの確定/キャンセル直後に必ず1回来る click は、**capture フェーズで1回だけ消費**する
//（#244 段2・Codexレビュー4巡目）。個別ハンドラ先頭のガード方式には2つの穴があった:
//   (a) ガードは伝播を止めないため、同じ click が SVG 背景ハンドラまで進んで
//       選択中の弧を解除してしまう
//   (b) 記号・松葉のヒット領域は自前で stopPropagation するためガードに届かず素通り
// capture はどの要素ハンドラよりも先に走るので、ここで消費して遮断すれば
// 到達先がどこであっても1回で確実に読み飛ばせる。消費の実装はこの1箇所だけにする。
// 仕様の dispatch 上は stopPropagation でも足りる（capture 側で stop propagation
// フラグが立てば、同一要素の bubble 側 invoke も開始時に打ち切られる。jsdom で実証済み）。
// それでも **stopImmediatePropagation** を使うのは防御のため: 将来この svg の
// capture フェーズ（＝同一フェーズ）にリスナーが追加されても、消費済み click を
// 確実に遮断できる（同一フェーズの後続リスナーは stopPropagation では止まらない）。
svg.addEventListener('click',(e)=>{
  // 記号のドラッグ（Issue #522）も同じ扱い。ドラッグ中に SVG は作り直されるため、
  // 離した後の click は当たり判定 rect ではなく背景へ届くことがある
  if(dragSessionsRef.current.arcMoved||dragSessionsRef.current.symbolOffsetMoved){
    dragSessionsRef.current.arcMoved=false;
    dragSessionsRef.current.symbolOffsetMoved=false;
    e.stopImmediatePropagation();
  }
},true);

// SVG 背景クリック → 弧の選択を解除
//（ドラッグ直後の click は上の capture 消費が先に遮断するため、ここには届かない）
svg.addEventListener('click',()=>{
  dragSessionsRef.current.tieStart=null;
  tiePreviewPath.style.display='none';
  setSelectedArc(null);
  setSelectedHairpin(null);
});

svg.addEventListener('mousemove',(ev)=>{
  // 弧のドラッグ中（端点・曲率）は window 側のハンドラが処理するので、ここでは何もしない。
  // 両方で処理すると同じ mousemove を2回適用してしまい、弧がカーソルの倍の速さで動く。
  if(dragSessionsRef.current.arcEp||dragSessionsRef.current.arcCp)return;
  // タイ／松葉 新規ドラッグのプレビュー
  if(!dragSessionsRef.current.tieStart||!('mode' in tool)||(tool.mode!=='tie'&&tool.mode!=='hairpin'))return;
  const{x:mx,y:my}=clientToGroup(svg,svgRoot,(ev as MouseEvent).clientX,(ev as MouseEvent).clientY);
  const{noteX:sx,noteY:sy,stemDir}=dragSessionsRef.current.tieStart;
  const upward=stemDir!==1;
  // 段またぎドラッグでは mx < sx（右→左）になるため Math.abs で判定する
  const hasMoved=Math.abs(mx-sx)>4||Math.abs(my-sy)>4;
  if(tool.mode==='hairpin'){
    // 松葉は弧ではなく直線区間の記号なので、プレビューも点線の直線で示す
    tiePreviewPath.setAttribute('d',`M ${sx} ${sy} L ${mx} ${my}`);
  }else{
    // 段またぎ時はマウスY座標も使って始点→現在位置のプレビュー弧を描く
    const{dAttr:d}=computeArcGeometry(sx,sy,mx,my,upward,'slur',stemDir,undefined,0);
    tiePreviewPath.setAttribute('d',d);
  }
  tiePreviewPath.style.display=hasMoved?'block':'none';
});
svg.addEventListener('mouseup',()=>{
  // 弧のドラッグの確定は window 側（arcDrag セッション）が受け持つ。
  // ここで受けると、SVG の外で指を離したときだけ確定されない不公平が生まれる。
  if(dragSessionsRef.current.arcEp||dragSessionsRef.current.arcCp)return;
  dragSessionsRef.current.tieStart=null;
  tiePreviewPath.style.display='none';
});
}
