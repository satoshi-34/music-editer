# 設計書: セキュリティ強化 (Security Hardening)

## 概要

2026-06 に実施したプロジェクト全体のセキュリティレビューで見つかった 2 件の問題に対する修正設計を記述します。
いずれも開発環境（Docker / 依存ライブラリ）に関するもので、アプリ本体のコード変更はありません。

| 分類 | 対象ファイル | 深刻度 |
|---|---|---|
| 依存ライブラリの既知脆弱性 | `package.json`, `package-lock.json` | Critical |
| 開発サーバーの公開範囲 | `docker-compose.yml` | 中 |

---

## 修正 1: vitest / @vitest/ui の Critical 脆弱性を解消

### 問題

`npm audit` で以下の既知脆弱性が検出された。

- **[Critical] vitest 4.0.0-beta.1 〜 4.1.0-beta.6 / @vitest/ui 同範囲**
  - [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp)
  - Vitest UI サーバーが起動している間、任意ファイルの読み取り・実行が可能になる
  - devDependency だが、開発中に `vitest --ui` を使うとローカルマシンが攻撃面になる
- **[Moderate] ws 8.0.0 〜 8.20.0**
  - [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx)
  - 未初期化メモリの開示

### 修正設計

依存追加ルール（`CLAUDE.md`）に従い、Docker コンテナ内で `--ignore-scripts` を付けて更新する。

```bash
# ws は推移的依存なので audit fix で解消
docker compose run --rm app npm audit fix --ignore-scripts
# vitest / @vitest/ui は audit fix で上がらなかったため明示的に更新
docker compose run --rm app npm install --ignore-scripts -D 'vitest@^4.1.8' '@vitest/ui@^4.1.8'
```

更新後のバージョン:

- `vitest`: 4.0.17 → ^4.1.8
- `@vitest/ui`: 4.0.17 → ^4.1.8
- `ws`（推移的依存）: 8.21.0 へ更新済み

### 影響範囲

- テストランナーのみ。アプリ本体の依存（react / vexflow / tone / soundfont-player）は変更なし
- 全テスト 553 件（38 ファイル）がコンテナ内でパスすることを確認済み
- `npm audit` の検出件数が 0 件になったことを確認済み

---

## 修正 2: 開発サーバーのホスト側バインドを 127.0.0.1 に限定

### 問題

`docker-compose.yml` の `ports: "5173:5173"` はホストの 0.0.0.0（全ネットワークインターフェース）に
バインドされるため、同じ LAN 上の他端末から Vite 開発サーバーへ到達できた。

- Vite の dev サーバーはソースコードをそのまま配信する
- 開発ツール（修正 1 の Vitest UI など）の脆弱性と組み合わさるとリスクが拡大する

### 修正設計

ホスト側バインドをループバックアドレスに限定する。

```yaml
ports:
  - "127.0.0.1:5173:5173"
```

- コンテナ内の `--host`（Vite を 0.0.0.0 で listen）は、Docker のポートマッピングが
  コンテナ外からの接続として届くために必要なので**そのまま残す**
- devcontainer の `forwardPorts` は VS Code が別途トンネルするため、この変更で影響を受けない
- あわせて Compose V2 で廃止された `version:` 属性を削除（起動時警告の解消）

### 影響範囲

- 開発環境のみ。`http://localhost:5173` でのアクセスは従来どおり可能
- LAN 上の他端末（スマホ実機確認など）からアクセスしたい場合は、一時的に
  `ports` を `"5173:5173"` に戻すか、VS Code のポート転送（Public 設定）を使う

---

## レビューで確認した上で「修正不要」と判断した点

- **localStorage 読込（`src/utils/storage.ts`）**: 許可リスト方式のスキーマ検証が実装済みで、
  手編集された JSON が VexFlow や再生経路へ流れ込むリスクは低い
- **XSS**: `dangerouslySetInnerHTML` 不使用。`innerHTML` は描画クリアと静的文字列のみ
- **SoundFont の外部 CDN 取得（`src/audio/SoundFontEngine.ts`）**: パック名は許可リストで
  検証済み。外部依存である点は README に明記した（将来公開時は自己ホストを検討）
- **CSP 未設定**: 現状 XSS の入口がなく開発用途のため見送り。本番ビルドを配布する段階で
  `script-src 'self'` + SoundFont CDN への `connect-src` を設定すること
