#!/usr/bin/env node
import { execSync } from "node:child_process";

console.log("🧹 Blocksプロセスをクリーンアップ中...");

const ports = [3000, 3001, 3002, 3003];
for (const port of ports) {
	try {
		const pids = execSync(`lsof -ti:${port}`, { encoding: "utf-8" })
			.trim()
			.split("\n");
		for (const pid of pids) {
			try {
				execSync(`kill ${pid}`);
				console.log(`✓ ポート${port}のプロセス${pid}を終了しました`);
			} catch {}
		}
	} catch {}
}
console.log("✓ クリーンアップ完了");
