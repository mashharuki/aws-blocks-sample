# テスト・デプロイ運用

AWS Blocks プロジェクトの開発〜検証〜本番デプロイ〜クリーンアップのワークフロー、既存プロジェクトへの
統合方法、CDKによるカスタマイズ方法。SKILL.mdのStep 5/6、`migrate` モードの参考にする。

## 目次

1. [ローカル開発ワークフロー](#1-ローカル開発ワークフロー)
2. [テスト戦略](#2-テスト戦略)
3. [sandbox環境での検証](#3-sandbox環境での検証)
4. [本番デプロイ](#4-本番デプロイ)
5. [クリーンアップ](#5-クリーンアップ)
6. [CDKへのカスタマイズ降下](#6-cdkへのカスタマイズ降下)
7. [既存プロジェクトへの統合](#7-既存プロジェクトへの統合)
8. [コストの考え方](#8-コストの考え方)

---

## 1. ローカル開発ワークフロー

```bash
npm create @aws-blocks/blocks-app@latest my-app -- --template <template>
cd my-app
npm install
npm run dev
```

`npm run dev` はAWSアカウント・認証情報なしで完全に動作する。バックエンドのBlockはローカル実装
（メモリ/ファイルシステム）に自動的に切り替わり、状態は `.bb-data/` ディレクトリにJSON形式で保存される。

- `.bb-data/` は**gitignoreに入れる**（ローカル専用の一時データであり、チームで共有する状態ではない）
- ホットリロードが効くため、バックエンドのロジックを変更すると即座に反映される
- `npm run typecheck` でバックエンド〜フロントエンドを横断した型チェックを行う。デプロイ前に必ず実行する

## 2. テスト戦略

AWS Blocksアプリは3つのレイヤーでテストを考える。

**a. ビジネスロジックの単体テスト**

`ApiNamespace` のハンドラは通常の非同期関数なので、Vitest/Jest等で直接テストできる。
Block自体をモックする必要は薄い（ローカル実装が既に軽量なインメモリ動作をするため）。

```typescript
import { describe, it, expect } from 'vitest';
import { api } from '../aws-blocks';

describe('todos api', () => {
  it('creates and lists a todo', async () => {
    await api.createTodo('Buy milk');
    const todos = await api.listTodos();
    expect(todos.some((t) => t.title === 'Buy milk')).toBe(true);
  });
});
```

**b. ローカル統合テスト**

`npm run dev` を起動した状態、またはテストランナーからローカル実装を直接使い、フロントエンド〜
バックエンドを通した結合テストを行う。Agent/KnowledgeBaseを含む機能は、ローカルでは
cannedモデル/TF-IDF検索で動く点を踏まえ、「フローが正しく配線されているか」の検証に留める
（詳細は [ai-agent-patterns.md](ai-agent-patterns.md) の「ローカル開発時の挙動と注意点」）。

**c. sandbox環境での受け入れテスト**

実際のAWSリソース・実際のBedrockモデルを使った動作確認は次節の `npm run sandbox` で行う。
本番相当の挙動（DynamoDBのGSI、実際のLLM応答、presigned URLの有効期限等）はここでしか検証できない。

## 3. sandbox環境での検証

```bash
npx cdk bootstrap   # そのAWSアカウント/リージョンで初回のみ必要
npm run sandbox
```

`npm run sandbox` は一時的なAWS環境にバックエンドをデプロイする。CloudFormationスタックとして
DynamoDB・Lambda・API Gateway等のリソースが構築される。Hosting（CloudFront+S3のフロントエンド配信）は
含まないことが多く、ローカルのフロントエンドから実際にデプロイされたAWS上のAPIを呼び出す構成で検証する。

sandboxモードではテーブル等の削除保護が無効化されているため、`sandbox:destroy` で確実にクリーンアップできる。
検証用に頻繁に作り直す前提の環境として扱う。

```bash
npm run sandbox:destroy
```

## 4. 本番デプロイ

```bash
npm run deploy
```

Hostingを含むフルデプロイ。CloudFront + S3でフロントエンドが配信され、バックエンドのBlockも
本番用の設定（削除保護等）でデプロイされる。デプロイ前チェックリスト:

- [ ] `npm run typecheck` が通る
- [ ] `npm run sandbox` で一度は実AWS環境での動作確認をしている
- [ ] 認証が必要なエンドポイントで認可チェックが漏れていない（`review` モード参照）
- [ ] Agent Blockの破壊的ツールに `needsApproval: true` が付いている
- [ ] シークレットは `AppSetting` の `secret: true` 等、平文でコードに書いていない

## 5. クリーンアップ

```bash
npm run destroy          # 本番デプロイの削除
npm run sandbox:destroy  # sandbox環境の削除
```

ステートフルなBlock（Database, DistributedTable等）は本番デプロイでは削除保護が有効なことがあるため、
destroy前にデータのバックアップ要否を確認する。

## 6. CDKへのカスタマイズ降下

AWS Blocksアプリはそのまま CDK アプリケーションである。Blockで表現しきれない要件が出た場合は、
CDKのコンストラクトを直接追加できる。

```typescript
// aws-blocks/index.ts もしくは専用のCDKエントリポイント
import { Scope } from '@aws-blocks/blocks';
import * as waf from 'aws-cdk-lib/aws-wafv2';

const scope = new Scope('my-app');
// Blockの内部で生成されたCDKコンストラクトに直接アクセスして拡張することも可能
// （具体的なアクセス方法はBlockごとのCDKエクスポートに依存するため、型定義を確認する）

new waf.CfnWebACL(scope, 'WebAcl', { /* ... */ });
```

**方針**: まずBlockで表現できないか検討し、無理なら素のCDKコンストラクトを同じスタックに追加する。
Blocksのカタログにない要件（WAF、VPCピアリング、特殊なIAM境界等）はこのパスで解決する。
既存のAWS CDKの知見（`aws-cdk-architect` スキルのパターン集等）がそのまま活用できる。

## 7. 既存プロジェクトへの統合

`mode:migrate` で扱うシナリオ。AWS Blocksは「一度に全部」ではなく「1つずつ」導入できるよう
設計されている。

**既存CDKプロジェクトへの組み込み:**
既存のCDKスタックのコンストラクトツリーにBlockを追加する形で埋め込める。いきなり全バックエンドを
置き換えるのではなく、新規機能（例: 新しい非同期ジョブ、新しいAI機能）から先にBlockで実装し、
既存部分は素のCDKのまま残す、という混在期間を許容する。

**既存Amplifyプロジェクトとの共存:**
`--template amplify` は既存Amplifyプロジェクトとの共存を想定したテンプレート。Amplifyが
フロントエンドホスティング/CI/CDを担い、Blocksが新しいバックエンド機能を担う、という役割分担が可能。

**移行時の判断基準:**
- ステートフルなリソース（DBテーブル等）を今すぐBlock管理下に移すのはリスクが高い。まず新規機能から始める
- 既存のIAMロール・VPC等、他のスタックと密結合したリソースは、依存関係を洗い出してから移行順序を決める
- 移行中は一時的に「一部Block管理・一部手書きCDK」の状態になることを前提に、ドキュメント（README等）に
  現在の移行状況を明記しておく

## 8. コストの考え方

AWS Blocks自体の利用に追加料金はない。課金されるのは実際に使用したAWSリソース（DynamoDB, Lambda,
Aurora, Bedrock等）の標準料金のみ。コスト最適化の判断軸:

- アイドル時コストを避けたい → `DistributedDatabase`（Aurora DSQL）や DynamoDB系のBlock（オンデマンド課金）を優先
- sandbox環境は検証が終わったら都度 `sandbox:destroy` する運用を徹底し、放置課金を避ける
- Agent Blockはモデル呼び出しごとの課金が主要コスト要因になりやすい。ローカル開発でcannedモデルを
  活用し、実モデル呼び出しをsandbox/本番検証に絞ることでコストを抑えられる
