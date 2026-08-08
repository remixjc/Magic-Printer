#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

const input = process.argv[2] === "--" ? process.argv[3] : process.argv[2];
if (!input) {
  console.error("用法：pnpm inspect:file <文件路径>");
  process.exitCode = 2;
  process.exit();
}

const filePath = resolve(input);
try {
  const fileStat = await stat(filePath);
  const { HeuristicEncryptionDetector } = await import("../packages/platform/dist/index.js");
  const detection = await new HeuristicEncryptionDetector().inspect(filePath);
  const extension = basename(filePath).includes(".") ? basename(filePath).split(".").pop()?.toLowerCase() : "";
  console.log(JSON.stringify({ fileName: basename(filePath), path: filePath, extension, size: fileStat.size, detection }, null, 2));
  process.exitCode = detection.verdict === "plain" ? 0 : 10;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
