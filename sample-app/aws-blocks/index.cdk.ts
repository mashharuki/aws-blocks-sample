import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	BlocksStack,
	Hosting,
	SandboxDisableDeletionProtection,
} from "@aws-blocks/blocks/cdk";
import { getStackName } from "@aws-blocks/blocks/scripts";
import * as cdk from "aws-cdk-lib";
import { Mixins, RemovalPolicies } from "aws-cdk-lib";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = new cdk.App();

const sandboxMode = app.node.tryGetContext("sandboxMode") === "true";
const projectRoot = app.node.tryGetContext("projectRoot") || process.cwd();

const stackName = getStackName({ sandbox: sandboxMode, projectRoot });
export const blocksStack = await BlocksStack.create(app, stackName, {
	backendHandlerPath: join(__dirname, "index.handler.ts"),
	backendCDKPath: join(__dirname, "index.ts"),
});

if (sandboxMode) {
	// sandbox:destroy でスタック全体をクリーンアップできるよう、全リソースを削除可能にする。
	// これはスタック内の全リソース（以下で追加するものも含む）に対して、
	// 削除ポリシーと削除保護（RDS等）を上書きする。
	// 破棄処理を自分で管理したい場合はこれらの行を削除する。
	RemovalPolicies.of(blocksStack).destroy();
	Mixins.of(blocksStack).apply(new SandboxDisableDeletionProtection());

	// Cookieにクロスドメイン属性が必要であることをランタイムに伝える
	// （フロントエンドはlocalhost、APIはAPI Gateway — 登録可能ドメインが異なる）。
	blocksStack.handler.addEnvironment("BLOCKS_SANDBOX", "true");
}

// デプロイ時のみ静的サイトホスティングを追加する（サンドボックスモードでは追加しない）
if (!sandboxMode) {
	new Hosting(blocksStack, "Hosting", {
		root: join(__dirname, ".."),
		buildCommand: "npm run build",
		buildOutputDir: "dist",
		api: blocksStack,
	});
}
