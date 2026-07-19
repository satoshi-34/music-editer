// src/utils/pageSystemLayoutUtils.ts
// ─────────────────────────────────────────────────────────────
// ページごとの「段数（system 数）配分」を計算するヘルパー。
//
// 以前はタイトル・作曲者名などのヘッダーが載る1ページ目だけ、
// 市販譜の作法にならって段数を1段減らして組んでいた。
// しかし実際に印刷して確認したところ、タイトル下の余白が大きくなりすぎ
// 紙面が無駄になるとの判断から、この方式はやめて
// 「全ページ、常に同じ段数（systemsPerPage）を入れる」方式に統一した。
// タイトルページはヘッダーの実高さぶんだけ譜面領域が狭くなるが、
// その中で段を均等配置するだけでよい（見た目の行位置が中間ページと
// 揃わなくなる点は、紙面効率を優先するため許容している）。
// 詳細な経緯は .claude/specs/final-barline/design.md を参照。
//
// 全ページ段数が同じになったことで、「iページ目の開始位置」も
// 単純な `i * systemsPerPage` の掛け算で求められるようになった。
// それでも呼び出し側でこの計算を重複させないよう、引き続き
// このファイルの関数を経由する。
export type PageSystemLayoutOptions = {
  // 1ページあたりの段数（ユーザー設定の「段数/ページ」）
  systemsPerPage: number;
};

// pageIndex 番目のページに入る段数（キャパシティ）を返す。
// 全ページ同じ段数になったため、pageIndex に関わらず systemsPerPage を返す。
// ページ割りロジック全体は、必ずこの関数を通してページごとの段数を得ること
// （将来また「1ページ目だけ特別扱い」が必要になった場合に、ここだけ直せば済むように）。
export function getPageSystemsCapacity(_pageIndex: number, options: PageSystemLayoutOptions): number {
  return options.systemsPerPage;
}

// pageIndex 番目のページより前に、何段ぶんの段が既に置かれているか（＝そのページの開始オフセット）。
export function getPageSystemOffset(pageIndex: number, options: PageSystemLayoutOptions): number {
  if (pageIndex <= 0) return 0;
  return pageIndex * options.systemsPerPage;
}

// 「内容のある段の総数（0始まりの最後の段インデックス）」が何ページ目に収まるかを求める。
// 各ページの段数は必ず1以上のため、有限回のループで必ず終わる。
export function findPageIndexForSystem(targetSystemIndex: number, options: PageSystemLayoutOptions): number {
  let pageIndex = 0;
  let offset = 0;
  while (offset + getPageSystemsCapacity(pageIndex, options) <= targetSystemIndex) {
    offset += getPageSystemsCapacity(pageIndex, options);
    pageIndex += 1;
  }
  return pageIndex;
}
