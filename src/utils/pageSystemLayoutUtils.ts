// src/utils/pageSystemLayoutUtils.ts
// ─────────────────────────────────────────────────────────────
// ページごとの「段数（system 数）配分」を計算するヘルパー。
//
// 市販の楽譜は、タイトル・作曲者名などのヘッダーが載る1ページ目だけ、
// ヘッダーぶんの余白を確保するために譜面の段数を1段減らして組むのが作法。
// （2ページ目以降はヘッダーが無い/小さいので、設定どおりの段数まで詰め込める）
//
// ページごとに段数が変わりうるため、「iページ目の開始位置」を求めるときに
// 単純に `i * systemsPerPage` のような掛け算をしてはいけない。
// このファイルの関数を必ず経由し、1ページ目だけ特別な段数であることを
// 累積計算（オフセット）としてまとめて扱う。
export type PageSystemLayoutOptions = {
  // 1ページあたりの基本段数（ユーザー設定の「段数/ページ」）
  systemsPerPage: number;
  // タイトル・作曲者名などのヘッダーが1ページ目にあるかどうか。
  // false のときは従来どおり全ページ同じ段数のまま（市販譜の作法を適用する意味が薄いため）
  hasTitlePageHeader: boolean;
};

// 1ページ目の段数だけ、ヘッダー分を差し引いて減らすべきかどうかを判定する。
// systemsPerPage が1のときに減らすと0段（空ページ）になってしまうため、
// そのときだけ例外的に減らさない。
export function shouldReduceFirstPageSystems(options: PageSystemLayoutOptions): boolean {
  return options.hasTitlePageHeader && options.systemsPerPage > 1;
}

// pageIndex 番目のページに入る段数（キャパシティ）を返す。
// ページ割りロジック全体は、必ずこの関数を通してページごとの段数を得ること。
export function getPageSystemsCapacity(pageIndex: number, options: PageSystemLayoutOptions): number {
  const { systemsPerPage } = options;
  if (pageIndex === 0 && shouldReduceFirstPageSystems(options)) {
    return systemsPerPage - 1;
  }
  return systemsPerPage;
}

// pageIndex 番目のページより前に、何段ぶんの段が既に置かれているか（＝そのページの開始オフセット）。
// 1ページ目だけ段数が異なりうるため、`pageIndex * systemsPerPage` のような単純な掛け算は使えず、
// 必ずこの累積計算を経由する。
export function getPageSystemOffset(pageIndex: number, options: PageSystemLayoutOptions): number {
  if (pageIndex <= 0) return 0;
  const firstPageSystems = getPageSystemsCapacity(0, options);
  return firstPageSystems + (pageIndex - 1) * options.systemsPerPage;
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
