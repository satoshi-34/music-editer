import type { RefObject } from 'react';
import { armClickCycle, planClickCycle, type ClickCycleState } from '../components/clickCycleUtils';
import type { ClickCycleTarget, PendingClickCycle } from './types';

interface ClickCycleRefs {
  clickCycleStateRef: RefObject<ClickCycleState | null>;
  clickCycleTargetsRef: RefObject<Map<Element, ClickCycleTarget>>;
}

/**
 * 描画された要素の重なり順から、再クリックで次に選ぶ対象を決める。
 * 描画ごとに作り直す台帳と、再描画をまたいで残す巡回状態を分けるため、
 * Canvas が所有する ref を受け取る。選択や編集の実処理は登録された候補に任せる。
 */
export function createClickCycle(svg: SVGSVGElement, refs: ClickCycleRefs) {
  const { clickCycleStateRef, clickCycleTargetsRef } = refs;
  // ── 再クリック巡回（Issue #264）の台帳と入口 ───────────────────────
  // 描画のたびに要素は作り直されるので、台帳も毎回まっさらにする。
  clickCycleTargetsRef.current=new Map();
  /** 当たり判定要素を「同じ場所の再クリックで選べる候補」として登録する */
  const registerClickCycleTarget=(el:Element,target:ClickCycleTarget)=>{
    // どの候補なのかを DOM からも見えるようにしておく（テスト・デバッグ用。表示には影響しない）
    el.setAttribute('data-cycle-id',target.id);
    clickCycleTargetsRef.current.set(el,target);
  };
  /**
   * その画面座標にある候補を、手前（前面）から奥の順に集める。
   * SVG に z-index は無く、ブラウザだけが正確な重なり順を知っているので
   * elementsFromPoint に聞く（要素の矩形を自前で総当たりすると、
   * 曲線の当たり判定＝スラーの帯を正しく判定できない）。
   */
  const collectClickCycleCandidates=(clientX:number,clientY:number):ClickCycleTarget[]=>{
    const doc=svg.ownerDocument;
    // jsdom など elementsFromPoint を持たない環境では巡回を諦める（従来どおりの1回目の挙動）
    if(typeof doc?.elementsFromPoint!=='function')return [];
    const found:ClickCycleTarget[]=[];
    doc.elementsFromPoint(clientX,clientY).forEach(el=>{
      const target=clickCycleTargetsRef.current.get(el);
      if(!target)return;
      // 同じ対象が複数の要素に分かれている場合（音符の固定範囲＋拡張部、段またぎの弧）は1件に畳む
      if(found.some(f=>f.id===target.id))return;
      if(!target.canActivate(clientX,clientY))return;
      found.push(target);
    });
    return found;
  };
  /**
   * 巡回すべきかを判定し、するなら「次に選ぶ対象」を返す（まだ実行はしない）。
   * null のときは呼び出し側が従来どおりの処理を続ける（進み具合はここで捨てる）。
   */
  const prepareClickCycle=(selfId:string,clientX:number,clientY:number)=>{
    const candidates=collectClickCycleCandidates(clientX,clientY);
    const plan=planClickCycle(clickCycleStateRef.current,clientX,clientY,candidates.map(c=>c.id),selfId);
    if(!plan){
      // 一巡して先頭へ戻った場合もここに来る。進み具合を捨てないと2周目が回らない
      clickCycleStateRef.current=null;
      return null;
    }
    const next=candidates.find(c=>c.id===plan.nextId);
    if(!next){clickCycleStateRef.current=null;return null;}
    return {
      clientX,clientY,consumed:plan.consumed,
      activate:()=>next.activate(clientX,clientY),
    };
  };
  /** 預けてあった巡回の計画をいま実行する */
  const commitClickCycle=(pending:PendingClickCycle)=>{
    clickCycleStateRef.current={clientX:pending.clientX,clientY:pending.clientY,consumed:pending.consumed};
    pending.activate();
  };
  /**
   * 巡回すべきなら即座に次の候補を選び直して true を返す（クリックで確定する対象向け）。
   * false のときは呼び出し側が従来どおりの処理を続ける。
   */
  const tryClickCycle=(selfId:string,clientX:number,clientY:number):boolean=>{
    const pending=prepareClickCycle(selfId,clientX,clientY);
    if(!pending)return false;
    commitClickCycle(pending);
    return true;
  };
  /** 「この対象を選んだ」ことを覚えて、次の同じ場所のクリックに備える */
  const armClickCycleFor=(selfId:string,clientX:number,clientY:number)=>{
    clickCycleStateRef.current=armClickCycle(clickCycleStateRef.current,clientX,clientY,selfId);
  };

  return { registerClickCycleTarget, prepareClickCycle, commitClickCycle, tryClickCycle, armClickCycleFor };
}
