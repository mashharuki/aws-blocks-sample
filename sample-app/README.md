# AWS Blocks App

認証、ユーザーごとのデータ分離、タブ間のライブ同期を備えたリアルタイムTodoアプリ。

## はじめに

```bash
npm run dev          # ローカルdevサーバーを起動（モック、AWS不要）
npm run test:e2e     # APIテストを実行
npm run sandbox      # AWSサンドボックスへデプロイ
```

`npm run dev` の後、http://localhost:3000 を開く。

## プロジェクト構成

| パス | 用途 |
|------|---------|
| `aws-blocks/index.ts` | バックエンド: 認証、データモデル、API、リアルタイムチャンネル |
| `src/index.ts` | フロントエンド: ライブ更新付きTodo UI |
| `test/e2e.test.ts` | テスト: 認証、CRUD、競合、リアルタイム |
| `index.html` | HTMLシェル |

## 含まれるもの

- **AuthBasic** — JWTセッションによるサインアップ/サインイン/サインアウト
- **DistributedTable** — Zodスキーマによる検証付きでDynamoDBに保存されるTodo
- **楽観的ロック** — `version` フィールド + `ifFieldEquals` で更新のロストを防止
- **Realtime** — Todoの変更をWebSocket経由で接続中の全タブへブロードキャスト

## コマンド

| コマンド | 説明 |
|---------|-------------|
| `npm run dev` | モックストレージでのローカル開発 |
| `npm run test:e2e` | 直接importでAPIをテスト |
| `npm run typecheck` | TypeScriptの型チェック |
| `npm run sandbox` | バックエンドをAWSへデプロイし、フロントエンドはローカルで提供 |
| `npm run deploy` | 本番フルデプロイ |
| `npm run sandbox:destroy` | サンドボックスリソースを削除 |

## このテンプレートを土台にする

テストファイル（`test/e2e.test.ts`）はセクションごとに構成されている — 認証、CRUD、競合、リアルタイム。`test(...)` ブロックをコピーしてアサーションを変更することで、独自のテストを追加できる。`aws-blocks/index.ts` のAPIメソッドは一貫したパターンに従う: 認証する → 処理する → ブロードキャストする。

Todoドメインを独自のものに置き換えるには: Zodスキーマを更新し、APIメソッドをリネームし、テストを調整する。認証とリアルタイムの配線はそのまま使える。

## スタック命名

CloudFormationスタック名は `.blocks/config.json` の `stackId` から導出される — スキャフォールド時にプロジェクト名とランダムなサフィックスから生成される（例: `my-app-a3x9kf`）。本番デプロイは `<stackId>-prod` として、サンドボックスは `<stackId>-<username>-<random>` としてデプロイされ、サンドボックス識別子はマシンごとに `.blocks-sandbox/sandbox-id.txt`（gitignore対象）に保存される。これにより複数の開発者がテスト用アカウントを衝突なく共有できる。

スタック名を変更するには `.blocks/config.json` の `stackId` を編集する。動的な命名ロジックが必要な場合は `aws-blocks/index.cdk.ts` を直接変更する。

## エージェント向け

Building Blockの完全なドキュメント: `node_modules/@aws-blocks/blocks/README.md`

**ローカルファイルやインメモリストレージを使わないこと** — すべてのデータ永続化とクラウド抽象化にBuilding Blockを使う（ローカルでは自動的にモックされ、AWSへも自動的にデプロイされる）。

`aws-blocks/index.ts`（バックエンド）と `src/index.ts`（フロントエンド）から始める。`npm run test:e2e` でテストする。APIトランスポート（JSON-RPC）は自動生成され、意図的に不可視になっている — エンドポイントに直接curlしない。テストはフロントエンドと同じ型付きクライアントを使うe2eテストを通じて行うのが最善。
