# Claude Code プロジェクト指針

## 言語

- **すべての応答は日本語で行う**
- コード内のコメントは日本語で記述する
- エラーや説明も日本語で提供する

## コミットメッセージ

**ハイブリッド形式**（1行目は英語、詳細は日本語）で記述する。

- **1行目（要約）**: 英語で記述する（Conventional Commits 形式 `<type>: <summary>`）
- **2行目以降（詳細）**: 日本語の箇条書きで、修正内容・理由・背景を記述する
- 詳細が自明な場合は1行目のみでも可

### type 一覧

| type | 用途 |
|---|---|
| feat | 新機能の追加 |
| fix | バグ修正 |
| docs | ドキュメントのみの変更 |
| refactor | 機能変更を伴わないコード整理 |
| test | テストの追加・修正 |
| chore | ビルド設定や依存関係の変更 |

### 例

```
fix: solve coordinate mismatch on scaled canvas

- スケール適用時のクリック座標計算ロジックを修正
- getScreenCTM の逆行列を使用し、ズーム倍率に関わらず正確な位置を特定できるようにした
```

```
feat: add semitone transposition via Alt+arrow keys

- Alt+↑/↓ で半音移動する機能を追加
- 上移動はシャープ表記、下移動はフラット表記を採用
```

```
docs: add pitch conversion design spec
```

## コードスタイル

- 識別子（変数名・関数名・クラス名）は英語を使用
- TypeScript の型は明示的に付与する
- VexFlow の API は既存パターンに従う
