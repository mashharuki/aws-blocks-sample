---
name: aws-blocks-architect
description: >
  AWS Blocks（"Infrastructure from Code"思想のOSSフルスタックTypeScriptフレームワーク）を使った
  アプリの設計・実装・テスト・デプロイを包括的にサポートするスキル。要件を聞き取り、KVStore/Database/
  AuthCognito/Agent/KnowledgeBase等のBlockを選定し、Scope・ApiNamespaceによるバックエンド定義から
  フロントエンド連携（型安全RPC、useChat）、npm run dev/sandbox/deployのワークフローまで一気通貫で対応する。
  Use when: (1) AWS Blocksでアプリを作りたい, (2) AWS Blocksのバックエンドを設計・実装したい,
  (3) AWS BlocksでどのBlockを使うべきか相談したい, (4) AWS BlocksのAIエージェント/KnowledgeBaseを実装したい,
  (5) AWS Blocksプロジェクトの型安全なフロントエンド連携をしたい, (6) npm run dev/sandbox/deployの使い方を知りたい,
  (7) 既存AWS Blocksコードをレビューしたい, (8) AWS BlocksプロジェクトをCDKでカスタマイズ・拡張したい,
  (9) 既存のCDK/Amplifyプロジェクトに段階的にAWS Blocksを組み込みたい, (10) AWS Blocksの
  ローカル開発からAWS本番環境へのデプロイ・クリーンアップ手順を知りたい。
  「AWS Blocks」「aws-blocks」「Infrastructure from Code」「IFC」「npm create @aws-blocks」「Block」
  「KVStore」「DistributedTable」「AuthCognito」「Agent Block」「KnowledgeBase Block」等の
  キーワードで呼び出す。他のツール（CDK単体、Amplify）と迷う場面でも、ローカルファーストかつ
  型推論ベースの開発体験を求めている場合は積極的にこのスキルを使うこと。
---

# AWS Blocks Architect

AWS Blocks によるフルスタックアプリの設計・実装・テスト・デプロイを一気通貫で支援するスキル。
ユーザーの要件を聞き取り、最適な Block の組み合わせを選定し、プロダクション品質の TypeScript コードを生成する。

## AWS Blocks の前提知識

作業を始める前に、以下の核となる仕組みを理解しておく（詳細はコード生成時に活きてくる）。

- **Block = 自己完結したバックエンド機能**。1つのnpmパッケージが「クラウドリソース・ランタイムAPI・ローカル実装」を同梱する。組み合わせは自由で、どのBlockも他のBlockと組み合わせて動く。
- **Conditional Exportsによる3つの顔**。同じ `new KVStore(scope, 'todos')` という1行が、
  - ローカル開発時: インメモリ/ファイルシステム（`.bb-data/`）のモック実装
  - CDK synthesis時: CloudFormationテンプレートを生成するCDKコンストラクト
  - Lambda実行時: AWS SDK経由の実際のAPI呼び出し
  に自動的に解決される。**コードは一切変更不要。**
- **AWSアカウントはデプロイ時のみ必要**。`npm run dev` はローカルで完結し、認証情報なしで動く。
- **型安全性はコード生成なしで実現**。バックエンドで定義した関数・スキーマの型が、importするだけでフロントエンドに伝播する。
- **天井がない**。各Blockは本番のAWSサービス（DynamoDB, Aurora, Bedrock等）で構成されたCDKコンストラクトなので、必要ならCDKへ降りて直接カスタマイズできる。既存のCDKスタックにも埋め込める。

このスキルはプレビュー段階のプロダクト（2026年6月プレビュー発表）を扱う。API仕様が変わっている可能性があるため、
不確実なAPI詳細に直面したら、コードを断定的に書く前に `npm view @aws-blocks/blocks-app version` や
公式ドキュメント（https://docs.aws.amazon.com/blocks/latest/devguide/）で最新情報を確認する。

## 引数（mode）

- **mode**: 動作モード（デフォルト: `implement`）
  - `design`: 要件ヒアリング → Block選定・アーキテクチャ設計のみ
  - `implement`: 要件 → 設計 → バックエンド/フロントエンドコード生成まで一気通貫
  - `review`: 既存 AWS Blocks プロジェクトのレビュー・改善提案
  - `init`: 新規プロジェクトのセットアップ（`npm create` テンプレート選定含む）
  - `migrate`: 既存のCDK/Amplify/素のバックエンドへAWS Blocksを段階的に組み込む

## 実行手順

### Step 1: 要件の整理

ユーザーの入力から以下を整理する。不明な点は質問して確認する。

**必須情報:**
- 作りたいアプリの概要（何を管理・提供するアプリか）
- 必要な機能カテゴリ: データ永続化、認証、リアルタイム通信、ファイル、バックグラウンド処理、AIエージェント/RAG
- フロントエンドのフレームワーク（Next.js / React / Vue / Nuxt / Astro / モバイル(Swift, Kotlin, Flutter) / なし）
- 既存プロジェクトがあるか（ある場合は `aws-blocks/` ディレクトリと `package.json` を読む）

**確認すべき項目:**
- 認証方式の要件（自前実装でよいか、Cognito等のマネージドが必要か、外部IdP連携か）
- データの形（KVペア程度か、インデックス検索が要るか、リレーショナルSQLが要るか）
- AIエージェントが必要な場合、ツール実行に承認フロー（HITL）が必要か
- 想定スケール・コスト制約（アイドル時ゼロコストが欲しいか）
- 既存のCDKスタックと共存させる必要があるか

### Step 2: Block の選定

要件に基づいて Block を選ぶ。判断に迷ったら以下の基準で決める。全Blockの詳細な設定オプションと
コード例は [references/blocks-catalog.md](references/blocks-catalog.md) を参照する。

#### データ・ストレージの選び方

| 要件 | 選ぶBlock | 理由 |
|------|-----------|------|
| シンプルなKey-Value、条件付き書き込み | `KVStore` | DynamoDB単一テーブル、最軽量 |
| セカンダリインデックス・クエリが必要な構造化データ | `DistributedTable` | DynamoDB + GSI、Todo/CRUDアプリの定番 |
| JOINや複雑な集計、既存SQL資産の活用 | `Database` | Aurora Serverless v2 + Kysely |
| アイドル時コストを完全ゼロにしたいSQL | `DistributedDatabase` | Aurora DSQL、サーバーレスSQL |
| ファイルアップロード・配信 | `FileBucket` | S3 + presigned URL |

#### 認証の選び方

| 要件 | 選ぶBlock | 理由 |
|------|-----------|------|
| 最小構成、独自の認証フローを自分で組みたい | `AuthBasic` | ステートマシンAPI、DynamoDB + JWT |
| MFA・グループ管理・パスキー等マネージド機能が欲しい | `AuthCognito` | Amazon Cognito |
| Google/GitHub/OktaなどのSSO | `AuthOIDC` | OAuthリダイレクトフロー |

#### AI機能の選び方

| 要件 | 選ぶBlock |
|------|-----------|
| ドキュメント検索・RAG | `KnowledgeBase` |
| ツール実行可能な対話エージェント（承認フロー込み） | `Agent` |

詳細な実装パターン（`needsApproval` によるHuman-in-the-Loop、`useChat` フック等）は
[references/ai-agent-patterns.md](references/ai-agent-patterns.md) を参照する。

その他のカテゴリ（非同期処理、通信、設定、監視、ホスティング）も
[references/blocks-catalog.md](references/blocks-catalog.md) に一覧化している。

### Step 3: バックエンドコードの生成

`aws-blocks/index.ts`（プロジェクト作成時のデフォルトエントリポイント名。既存プロジェクトの場合は
実際のファイルを確認する）に、選定した Block を `Scope` 配下でインスタンス化し、`ApiNamespace` で
呼び出し可能な関数を公開する。

**基本パターン:**

```typescript
import { ApiNamespace, Scope, DistributedTable, AuthBasic } from '@aws-blocks/blocks';

const scope = new Scope('my-app');

const auth = new AuthBasic(scope, 'auth');

const todos = new DistributedTable(scope, 'todos', {
  schema: { id: 'string', userId: 'string', title: 'string', completed: 'boolean' },
  key: { partition: 'userId', sort: 'id' },
});

export const api = new ApiNamespace(scope, 'api', (context) => ({
  async createTodo(title: string) {
    const user = await auth.getCurrentUser(context);
    return todos.put({ id: crypto.randomUUID(), userId: user.id, title, completed: false });
  },
  async listTodos() {
    const user = await auth.getCurrentUser(context);
    return todos.query({ partition: user.id });
  },
}));
```

**コーディング規約:**

- `Scope` はアプリ全体で1つ、各 Block の第一引数として渡す
- Block の第二引数（ID）は論理IDとして機能する。**一度デプロイした後にリネームすると別リソース扱いになる**ため、
  安定した名前を最初から選ぶ
- `ApiNamespace` のハンドラ内でのみビジネスロジックを書く。Block のインスタンス化はモジュールのトップレベルで行う
  （リクエストごとに `new` しない）
- 認証が必要なエンドポイントは必ずハンドラ冒頭で `auth.getCurrentUser(context)` 等のチェックを行う。
  フロントエンドからの入力を信頼しない
- スキーマは Zod 等を使い、ランタイム検証・TypeScript型・（該当Blockでは）テーブル形状を兼ねさせる

### Step 4: フロントエンド連携

型安全なRPCクライアントの使い方、フレームワーク別の統合方法（Next.js/React/Vue/モバイル）は
[references/frontend-integration.md](references/frontend-integration.md) を参照する。要点:

```typescript
import { api } from 'aws-blocks';

const todos = await api.listTodos();
```

コード生成ステップは不要。バックエンドの `export const api = ...` の型がそのままフロントエンドに伝わるため、
バックエンドの関数シグネチャを変えた場合はフロントエンドの呼び出し側で即座に型エラーが出る。これを利用して
変更の影響範囲を確認する。

### Step 5: ローカル開発とテスト

```bash
npm run dev          # AWSアカウント不要。.bb-data/ にローカル状態を保存
npm run typecheck     # バックエンド/フロントエンド全体の型チェック
```

ローカル実装の挙動（Database BlockはPGliteでAuroraを再現、Agent BlockはTF-IDF検索+cannedモデルで
LLM呼び出しなしに動く等）を踏まえたテスト戦略、`npm run sandbox` での実AWS環境での検証、
本番デプロイ、リソース削除の手順は [references/testing-deployment.md](references/testing-deployment.md) を参照する。

### Step 6: デプロイ手順の提示

コード生成後、以下の手順を提示する。

```bash
# 1. 依存関係のインストール
npm install

# 2. 型チェック
npm run typecheck

# 3. ローカルで動作確認
npm run dev

# 4. 一時的なAWS環境（sandbox）で検証（初回は npx cdk bootstrap が必要）
npm run sandbox

# 5. 問題なければ本番デプロイ（CloudFront/S3のHostingを含むフルデプロイ）
npm run deploy

# 6. 検証用リソースの削除
npm run sandbox:destroy   # または npm run destroy
```

## review モード

`mode:review` の場合、以下の観点で既存の `aws-blocks/` 配下のコードをレビューする。

1. **Block選定の妥当性**: 要件に対してオーバースペック/アンダースペックなBlockを使っていないか
2. **認証チェックの漏れ**: `ApiNamespace` のハンドラで認証・認可チェックを省略していないか
3. **論理IDの安定性**: Blockの第二引数（ID）が変更されておらずリソースの再作成を招かないか
4. **Scopeの構成**: Blockのインスタンス化がモジュールトップレベルで一度だけ行われているか
5. **型安全性の活用**: フロントエンドが `any` で回避せず、`api` の型推論を活かしているか
6. **HITLの要否と承認者チェック**: Agent Blockのツールで、破壊的操作（決済・キャンセル・削除等）に
   `needsApproval: true` が付いているか。さらに「誰かの承認が要る」要件の場合、承認を実行するAPI側で
   承認者の権限チェックと「依頼者本人ではないか」の自己承認防止がサーバー側で行われているか
   （UIでボタンを出し分けるだけになっていないか、[ai-agent-patterns.md](references/ai-agent-patterns.md) §3 参照）
7. **ローカル/本番差分**: ローカルのモック動作（cannedモデル等）を前提にした本番でも壊れないロジックになっているか

## migrate モード

`mode:migrate` の場合、既存のCDKプロジェクトやAmplifyプロジェクトへの段階的導入を支援する。
AWS BlocksはCDKアプリケーションであるため、既存のCDKスタックに埋め込むか、新しいBlockアプリを
既存インフラの隣に立てて1つずつ機能を移行するパスを提示する。詳細は
[references/testing-deployment.md](references/testing-deployment.md) の「既存プロジェクトへの統合」を参照する。

## init モード

`mode:init` の場合、以下のコマンドでプロジェクトを作成する。

```bash
npm create @aws-blocks/blocks-app@latest my-app -- --template <template>
cd my-app
npm install
```

テンプレート選択の目安:

| テンプレート | 用途 |
|-------------|------|
| `default` | まず動くものを見たい場合の最小構成 |
| `nextjs` | Next.jsフロントエンド込みのフルスタック |
| `react` | React (Vite等) フロントエンド込み |
| `auth-cognito` | Cognito認証がすぐ使える状態から始めたい |
| `demo` | 機能を一通り確認したいデモアプリ |
| `bare` | バックエンドのみ、フロントエンドは自前で用意 |
| `backend` | バックエンド専用（APIサーバーとして使う） |
| `amplify` | 既存Amplifyプロジェクトとの共存を想定 |

システム要件: Node.js 22以上、npm 10以上。

## 関連リソース

- [Blockカタログ詳細](references/blocks-catalog.md) - 全Blockの設定オプションとコード例
- [フロントエンド連携](references/frontend-integration.md) - 型安全RPC、フレームワーク別統合
- [AIエージェントパターン](references/ai-agent-patterns.md) - Agent/KnowledgeBase、HITL
- [テスト・デプロイ運用](references/testing-deployment.md) - npm scripts、既存プロジェクトへの統合、CDKカスタマイズ
- [AWS Blocks 公式ドキュメント](https://docs.aws.amazon.com/blocks/latest/devguide/what-is-blocks.html)
- [AWS Blocks GitHub](https://github.com/aws-devtools-labs/aws-blocks)
- [AWS Blocks 製品ページ](https://aws.amazon.com/jp/products/developer-tools/blocks/)
