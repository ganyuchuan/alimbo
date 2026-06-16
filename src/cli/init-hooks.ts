#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type WriteMode = {
  force: boolean;
};

function printHelp() {
  console.log("Usage: alimbo init-hooks [--force]");
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function rewriteClaudeSettings(raw: string) {
  return raw.replaceAll("node hooks/scripts/claude/", "node .claude/scripts/claude/");
}

function rewriteCopilotHooks(raw: string) {
  return raw.replaceAll("node hooks/scripts/copilot/", "node .github/hooks/scripts/copilot/");
}

function writeTextFile(targetPath: string, content: string, mode: WriteMode) {
  if (!mode.force && fs.existsSync(targetPath)) {
    console.log(`[alimbo-init-hooks] skip existing: ${targetPath}`);
    return;
  }

  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content, "utf8");
  console.log(`[alimbo-init-hooks] wrote: ${targetPath}`);
}

function copyFile(sourcePath: string, targetPath: string, mode: WriteMode) {
  if (!mode.force && fs.existsSync(targetPath)) {
    console.log(`[alimbo-init-hooks] skip existing: ${targetPath}`);
    return;
  }

  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
  console.log(`[alimbo-init-hooks] copied: ${targetPath}`);
}

function copyDirFiles(sourceDir: string, targetDir: string, mode: WriteMode) {
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirFiles(sourcePath, targetPath, mode);
      continue;
    }

    if (entry.isFile()) {
      copyFile(sourcePath, targetPath, mode);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const force = args.includes("--force");
  const mode: WriteMode = { force };

  const cwd = process.cwd();
  const hooksRoot = path.resolve(__dirname, "../hooks");

  const sourceClaudeSettings = path.resolve(hooksRoot, "configs/settings.json");
  const sourceCopilotHooks = path.resolve(hooksRoot, "configs/alimbo-intercept.json");
  const sourceScriptsRoot = path.resolve(hooksRoot, "scripts");

  if (!fs.existsSync(sourceClaudeSettings) || !fs.existsSync(sourceCopilotHooks) || !fs.existsSync(sourceScriptsRoot)) {
    throw new Error(`hooks template not found under ${hooksRoot}. run npm run build first or reinstall package.`);
  }

  const targetClaudeSettings = path.resolve(cwd, ".claude/settings.json");
  const targetCopilotHooks = path.resolve(cwd, ".github/hooks/alimbo-intercept.json");

  const claudeSettingsRaw = fs.readFileSync(sourceClaudeSettings, "utf8");
  const copilotHooksRaw = fs.readFileSync(sourceCopilotHooks, "utf8");

  writeTextFile(targetClaudeSettings, rewriteClaudeSettings(claudeSettingsRaw), mode);
  writeTextFile(targetCopilotHooks, rewriteCopilotHooks(copilotHooksRaw), mode);

  copyFile(path.resolve(sourceScriptsRoot, "_common.mjs"), path.resolve(cwd, ".claude/scripts/_common.mjs"), mode);
  copyDirFiles(path.resolve(sourceScriptsRoot, "claude"), path.resolve(cwd, ".claude/scripts/claude"), mode);

  copyFile(path.resolve(sourceScriptsRoot, "_common.mjs"), path.resolve(cwd, ".github/hooks/scripts/_common.mjs"), mode);
  copyDirFiles(path.resolve(sourceScriptsRoot, "copilot"), path.resolve(cwd, ".github/hooks/scripts/copilot"), mode);

  console.log("[alimbo-init-hooks] done");
  console.log(`[alimbo-init-hooks] cwd: ${cwd}`);
}

try {
  main();
} catch (error) {
  console.error(`[alimbo-init-hooks] failed: ${String((error as Error)?.message ?? error)}`);
  process.exit(1);
}
