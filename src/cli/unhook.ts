#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function printHelp() {
  console.log("Usage: alimbo unhook");
}

function removePath(targetPath: string) {
  if (!fs.existsSync(targetPath)) {
    console.log(`[alimbo-unhook] skip missing: ${targetPath}`);
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  console.log(`[alimbo-unhook] removed: ${targetPath}`);
}

function removeIfEmpty(targetDir: string) {
  if (!fs.existsSync(targetDir)) {
    return;
  }

  const stat = fs.statSync(targetDir);
  if (!stat.isDirectory()) {
    return;
  }

  const children = fs.readdirSync(targetDir);
  if (children.length === 0) {
    fs.rmdirSync(targetDir);
    console.log(`[alimbo-unhook] removed empty dir: ${targetDir}`);
  }
}

function restoreOrRemoveHookConfig(targetPath: string) {
  const targetBackupPath = `${targetPath}.alimbo.backup`;
  if (fs.existsSync(targetBackupPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
    fs.renameSync(targetBackupPath, targetPath);
    console.log(`[alimbo-unhook] restored: ${targetPath}`);
    return;
  }

  removePath(targetPath);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const cwd = process.cwd();

  const hookConfigTargets = [
    path.resolve(cwd, ".claude/settings.json"),
    path.resolve(cwd, ".github/hooks/alimbo-intercept.json"),
    path.resolve(cwd, ".kimi-code/config.toml"),
    path.resolve(cwd, ".codex/hooks.json"),
  ];

  for (const target of hookConfigTargets) {
    restoreOrRemoveHookConfig(target);
  }

  const targets = [
    path.resolve(cwd, ".claude/scripts"),
    path.resolve(cwd, ".github/hooks/scripts"),
    path.resolve(cwd, ".kimi-code/hooks"),
    path.resolve(cwd, ".codex/hooks/_common.mjs"),
    path.resolve(cwd, ".codex/hooks/alimbo"),
  ];

  for (const target of targets) {
    removePath(target);
  }

  removeIfEmpty(path.resolve(cwd, ".claude"));
  removeIfEmpty(path.resolve(cwd, ".github/hooks"));
  removeIfEmpty(path.resolve(cwd, ".github"));
  removeIfEmpty(path.resolve(cwd, ".kimi-code"));
  removeIfEmpty(path.resolve(cwd, ".codex/hooks"));
  removeIfEmpty(path.resolve(cwd, ".codex"));

  console.log("[alimbo-unhook] done");
  console.log(`[alimbo-unhook] cwd: ${cwd}`);
}

try {
  main();
} catch (error) {
  console.error(`[alimbo-unhook] failed: ${String((error as Error)?.message ?? error)}`);
  process.exit(1);
}
