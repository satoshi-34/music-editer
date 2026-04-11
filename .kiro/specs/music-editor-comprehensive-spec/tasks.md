# 実装計画: Music Editor MVP 包括的仕様

## 概要

Music Editor MVP の全機能実装状況を追跡するマスタータスクリストです。個別機能の詳細は各 spec フォルダを参照してください。

---

## タスク

### フェーズ 1: 基盤・レイアウト

- [x] 1. プロジェクト基盤の構築
  - React + TypeScript + Vite のセットアップ
  - VexFlow の導入と基本レンダリング確認
  - 基本コンポーネント構造（App / ScorePage / StaffCanvas）の設計
  - _要件: 1.1, 1.2_

- [x] 2. 五線譜の基本表示
  - ト音記号・4/4拍子の五線譜描画
  - 複数段レイアウト（systems × gap）
  - ページヘッダー（タイトル・作曲者情報）
  - _要件: 1.1, 1.2, 6.1, 6.2, 6.3, 6.4_

- [x] 3. 複数ページレイアウト
  - ScorePage でのページ分割
  - ページ番号表示
  - _要件: 1.3_

- [x] 4. レスポンシブ・スケール管理
  - 1200px 未満で1列レイアウトへの自動切り替え
  - useAutoPageScale フックの実装
  - _要件: 1.4, 1.5, 11.1, 11.2, 11.3_

### フェーズ 2: 音符配置・編集

- [x] 5. 音価・休符パレットの実装
  - Palette コンポーネント
  - 全音符〜六十四分音符・各休符の選択 UI
  - 選択状態の視覚フィードバック
  - _要件: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 6. SVG 座標変換の実装
  - clientToGroup 関数（CTM 逆変換）
  - getVexflowGroup ユーティリティ
  - 詳細: `.kiro/specs/click-position-fix/`
  - _要件: 5.1, 5.2, 5.3_

- [x] 7. Y方向スナップ（音高決定）
  - getSpacingBetweenLines() 基準の 0.5 行刻みスナップ
  - 加線域対応（EXTRA_TOP_LINES / EXTRA_BOTTOM_LINES）
  - lineToKeyTreble / keyToLineTreble 変換
  - _要件: 2.2, 2.3, 5.5_

- [x] 8. 小節幅の自動割り付け
  - UNIT_BY_DENOM テーブルによる音価別重み
  - minContentWidth 計算
  - 全音符・二分音符の下限幅保証
  - 詳細: `.claude/specs/measure-width-layout/`
  - _要件: 2.5_

- [x] 9. 音符挿入ロジック（X方向）
  - getAbsoluteX / BoundingBox による挿入位置計算
  - 拍数制限チェック（BEATS_PER_MEASURE）
  - _要件: 2.1, 2.4_

- [x] 10. ガイドライン表示
  - mousemove 時の横線・ドット表示
  - 小節境界内への制限
  - _要件: 5.4, 5.5, 11.4_

- [x] 11. 音符選択・キーボード編集
  - クリックによる音符選択（選択半径による判定）
  - Delete/Backspace で削除
  - ↑/↓ で線/間 1 段移動
  - Alt+↑/↓ で半音移動
  - Shift+↑/↓ で 1 オクターブ移動
  - Escape で選択解除
  - 詳細: `.claude/specs/pitch-conversion/`
  - _要件: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 12. 休符重なり防止
  - 時間ベース位置計算
  - 詳細: `.kiro/specs/rest-overlap-fix/`
  - _要件: 9.1, 9.2, 9.3, 9.4, 9.5_

### フェーズ 3: マルチページ分離

- [x] 13. 複数ページ音符分離バグの修正
  - startMeasureIndex プロパティによる絶対インデックス管理
  - クロージャのスコープ修正
  - 詳細: `.kiro/specs/multi-page-note-isolation/`
  - _要件: 2.1, 2.4_

### フェーズ 4: データ保存・読み込み

- [x] 14. LocalStorage 永続化
  - useScoreStorage フックの実装
  - saveScoreData / loadScoreData ユーティリティ
  - チェックサム検証・バージョン管理
  - 詳細: `.kiro/specs/score-save-load/`
  - _要件: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3_

- [x] 15. 楽譜メタデータの編集・保存
  - タイトル・サブタイトル・作詞者・作曲者・編曲者のインライン編集
  - 保存・読み込み時のメタデータ復元
  - _要件: 6.1, 6.2, 6.3, 7.2, 7.4_

### フェーズ 5: 音声再生

- [x] 16. SimpleAudioEngine の実装
  - Web Audio API 直接使用
  - 自動再生ポリシー対応（ユーザーインタラクション後に初期化）
  - 音高変換（VexFlow 形式 → 周波数）
  - 詳細: `.claude/specs/simple-audio-engine/`
  - _要件: 6.1, 6.2, 6.3_

- [x] 17. 再生制御 UI
  - PlaybackControls コンポーネント（再生/停止/一時停止）
  - テンポ設定（BPM）
  - 音色選択
  - 詳細: `.kiro/specs/note-playback/`
  - _要件: 3.1, 3.2, 3.3, 4.1, 5.1, 5.2_

- [x] 18. 再生位置ハイライト
  - PlaybackHighlight コンポーネント
  - 再生中の音符ハイライト
  - ページスクロール対応
  - _要件: 7.1, 7.2, 7.3, 7.4, 7.5_

### フェーズ 6: バグ修正・品質向上

- [x] 19. バグ修正（9件）
  - storage 再帰呼び出し / AudioContext null / リソースリーク / BoundingBox / スナップ精度 等
  - 詳細: `.claude/specs/bug-fixes/`

- [x] 20. 印刷対応
  - window.print() 呼び出し
  - 印刷用 CSS (@media print)
  - ツールバー非表示
  - _要件: 10.1, 10.2, 10.3, 10.4, 10.5_

---

## 未実装の拡張予定機能

- [ ] E1. 和音（複数音符の同時再生）
- [ ] E2. MIDI 出力
- [ ] E3. 楽譜エクスポート（PDF / MusicXML）
- [ ] E4. 複数楽器対応（多声部）
- [ ] E5. スラー・タイ・強弱記号等の音楽記号
- [ ] E6. 調号（Key Signature）対応
- [ ] E7. 拍子記号の変更（3/4, 6/8 等）

---

## 注意事項

- 各タスクは対応する要件番号を参照
- 詳細仕様が存在するタスクは `詳細:` にリンクを記載
- 拡張予定機能（E1〜）は MVP 外で将来の開発対象
