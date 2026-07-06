# CLAUDE.md

このファイルは、このリポジトリでコードを扱う際に Claude Code (claude.ai/code) へガイダンスを提供するものです。

## リポジトリの目的

これは **AWS Blocks**（`@aws-blocks/blocks`、AWS の "Infrastructure from Code" TypeScript フレームワーク）を学習・参照するためのリポジトリです。実際のアプリケーションは `sample-app/` にあります — `npm create @aws-blocks/blocks-app@latest` で生成し、その後拡張したリアルタイム Todo アプリです。リポジトリのルートには `.claude/` 配下のツールも含まれています。カスタムスキル（`.claude/skills/aws-blocks-architect`、AWS Blocks の設計・実装・レビュー・テスト・デプロイの知識をまとめたもの）と、プロジェクトルール（`.claude/rules/proactive-subagents-and-skills.md`、行動前にスキル/サブエージェントを積極的に使い、宣言する（"using [skill] to [purpose]"）ことを求めるもの）です。

アプリケーション関連の作業はすべて `sample-app/` の中で行います — 以下のコマンドを実行する前に `cd sample-app` してください。

## コマンド（`sample-app/` から実行）

```bash
npm run dev              # ローカル開発サーバー + フロントエンド、ストレージはモック — AWSアカウント不要
npm run test:e2e         # test/e2e.test.ts を実行（tsx経由のNode組み込みテストランナー）。dev serverが起動していなければ自動起動
npm run typecheck        # tsc --noEmit
npm run check            # bunx biome check --write .  （lint + format + import整理）
npm run format           # bunx biome format --write .
npm run build            # tsc && vite build -> dist/
npm run sandbox          # 開発者ごとの実AWSサンドボックススタックへバックエンドをデプロイし、フロントエンドはローカルでそれに対して提供
npm run sandbox:destroy  # サンドボックススタックを削除
npm run sandbox:console  # サンドボックススタックのリソースコンソールを開く
npm run deploy           # 本番フルデプロイ（バックエンド + CloudFront/S3 Hosting）
npm run destroy          # 本番スタックを削除
npm run cleanup          # ポート3000-3003に残った dev-server プロセスを終了
npm run spec             # blocks-generate-spec — aws-blocks/blocks.spec.json を再生成
```

依存関係は `bun`（`bun.lock` がロックファイル）で管理されています。上記のコマンドは `npm run ...` という表記ですが、`bun run <script>` も同じ `package.json` の scripts を読むため同様に動作します。

**単一の e2e テストを実行する**: `test/e2e.test.ts` は `node:test` を使用しており、`package.json` にテスト単位のCLIフィルタは用意されていません。そのため、コンパイル済み（またはtsx実行）のファイルに対して `node --test --test-name-pattern="<name>"` を直接使うか、他の `test(...)` ブロックを一時的にコメントアウトしてください。テストは1つの dev-server インスタンスを共有し、ファイル順に実行されます — CRUD/競合テストは以前のテストが残した状態に依存しています（例えば「todos: delete」は事前のテストが todo を作成していることを前提とする）。順序を変えて実行しないでください。

`sample-app/AGENTS.md` に従った高速なイテレーションのために: バックグラウンドで `npm run dev &` を一度実行し、`npm run test:e2e` を繰り返し実行してください — 既に起動しているサーバーを検出して再利用するため、毎回新しいサーバーを起動しません。

## アーキテクチャ

### conditional-exports（条件付きエクスポート）のトリック

すべての Building Block（`DistributedTable`、`AuthBasic`、`Realtime` など）は `aws-blocks/index.ts` で一度だけインスタンス化され、同じ import が実行される場所によって異なる実装に解決されます。

- **ローカル開発**（`npm run dev`）→ インメモリ/ファイルベースのモック（状態は `.bb-data/` 配下、gitignore対象）
- **CDK synth**（`npm run sandbox` / `deploy`）→ 実際のCDKコンストラクト → CloudFormation
- **Lambda ランタイム**（デプロイ後）→ 実リソースに対するAWS SDK呼び出し

フロントエンドは直接RESTエンドポイントと通信することはありません。`aws-blocks` 自身の `package.json` の exports map（`aws-blocks/package.json`）は、ブラウザ/`react-server` コンテキストでは `import ... from "aws-blocks"` を `client.js`（自動生成されるJSON-RPCプロキシ、gitignore対象、dev server/build時に再生成）に解決し、それ以外の場所では `index.ts` に直接解決します（完全な型推論が得られる）。**APIに対して手書きのfetch/curl呼び出しをしないでください** — 常に `import { api, authApi } from "aws-blocks"` を使い、メソッドを直接呼び出してください。これはフロントエンド（`src/index.ts`）でもテスト（`test/e2e.test.ts`）でも同様です。

### 3つのバックエンドエントリポイント

- `aws-blocks/index.ts` — 実際のバックエンド: `Scope`、Blockのインスタンス化（`AuthBasic`、`DistributedTable`、`Realtime`）、呼び出し可能なメソッドを公開する `ApiNamespace`。新機能を追加する際に編集するのはここです。
- `aws-blocks/index.cdk.ts` — CDKアプリのエントリポイント（`npx tsx -C cdk aws-blocks/index.cdk.ts`、`cdk.json` 経由で配線）。`index.ts` を `BlocksStack` でラップし、サンドボックス限定の削除ポリシー上書き（`RemovalPolicies`、`SandboxDisableDeletionProtection`）と本番限定の静的 `Hosting` を追加します。スタックレベルのCDKカスタマイズ（カスタムリソース、削除ポリシー、ホスティング設定）はこのファイルを編集してください — `index.ts` ではありません。
- `aws-blocks/index.handler.ts` — Lambdaのエントリポイント（`createLambdaHandler(() => import("./index.js"))`）。編集する必要はほとんどありません。

### データモデルの規約（`aws-blocks/index.ts` を参照）

- Zodスキーマは、ランタイムバリデーション・TypeScriptの型・（`DistributedTable` の場合は）DynamoDBテーブル形状を兼ねる、単一の情報源です。
- ユーザーごとの分離: `userId`（`auth.requireAuth(context)` から取得し、クライアントから渡される引数では決してない）が常にパーティションキーです。
- セカンダリインデックスはテーブルと一緒に宣言され（`indexes: { byPriority: {...} }`）、`table.query({ index, where: {...} })` で問い合わせます。これは非同期イテラブルを返すので `Array.fromAsync(...)` で収集します。
- 楽観的ロック: 書き込みのたびにインクリメントされる `version` フィールドを `table.put(data, { ifFieldEquals: { version } })` で強制します。チェックに失敗すると例外がスローされます — 呼び出し側は再読み込みしてリトライすべきです（`toggleTodo`/`updatePriority` とそのフロントエンド呼び出し側を参照。catch時にただ再度 `load()` しています）。
- リアルタイム更新: `Realtime.namespace(zodSchema)` が型付きチャンネルを定義し、バックエンドは各変更後に `rt.publish(name, key, payload)` を呼び、フロントエンドは `api.subscribeTodos()` → `channel.subscribe(callback)` を呼びます。

### スタック命名と複数開発者向けサンドボックス

`.blocks/config.json`（スキャフォールド時に生成）の `stackId` はCloudFormationスタックのベース名です。本番デプロイは `<stackId>-prod` として、`npm run sandbox` は `<stackId>-<username>-<random>` としてデプロイされ、マシンごとのサンドボックス識別子は `.blocks-sandbox/sandbox-id.txt`（gitignore対象）にキャッシュされます。これにより複数の開発者が1つのAWSアカウントを衝突なく共有できます。スタック名を変更するには `stackId` を直接編集してください。

### このアプリを編集するエージェントのためのルール（`sample-app/AGENTS.md` より）

- 永続化のためにローカルファイル・インメモリ配列・ローカルデータベースを絶対に使わないでください — 常にBuilding Blockを経由してください。ローカルではモックされ、自動的にデプロイされます。
- 見慣れないBlockを使う前に、`node_modules/@aws-blocks/blocks/docs/<package-name>.md` のドキュメントを確認してください（カタログ/決定木は `node_modules/@aws-blocks/blocks/docs/index.md`、完全ガイドは `node_modules/@aws-blocks/blocks/README.md`）。
- `npm run sandbox` / `npm run deploy` / `npm run sandbox:destroy` には実際のAWS認証情報が必要です。

### Lint/フォーマット

Biome（`biome.json`）: タブインデント、ダブルクォート、保存時に `organizeImports`。`npm run check`（書き込みモード）経由で実行 — 別途CI専用のチェックスクリプトはありません。
