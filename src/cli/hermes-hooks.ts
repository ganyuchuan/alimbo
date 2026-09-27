import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isMap, isSeq, parseDocument } from "yaml";
import { hermesHookEvents } from "../gateway/http-hooks-hermes.js";

function hookCommand(cwd: string) {
  const quote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;
  return `${quote(process.execPath)} ${quote(path.resolve(cwd, ".hermes/alimbo/hermes/event.mjs"))} ${quote(cwd)}`;
}

export function configureHermesHooks({ cwd, hooksRoot, remove = false, home = process.env.HERMES_HOME || path.join(os.homedir(), ".hermes") }: {
  cwd: string;
  hooksRoot?: string;
  remove?: boolean;
  home?: string;
}) {
  const configPath = path.resolve(home, "config.yaml");
  if (remove && !fs.existsSync(configPath)) return;
  const document = parseDocument(fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "{}\n");
  if (document.errors.length) throw new Error(`Invalid Hermes config: ${document.errors[0].message}`);
  if (document.contents != null && !isMap(document.contents)) throw new Error("Hermes config must be a YAML mapping");
  const command = hookCommand(cwd);
  const hooks = document.get("hooks", true);
  if (hooks != null && !isMap(hooks)) throw new Error("Hermes hooks must be a YAML mapping");
  if (!hooks && remove) return;
  if (!hooks) document.set("hooks", document.createNode({}));
  for (const event of hermesHookEvents) {
    const entries = document.getIn(["hooks", event], true);
    if (entries != null && !isSeq(entries)) throw new Error(`Hermes hooks.${event} must be a list`);
    if (isSeq(entries)) {
      entries.items = entries.items.filter(entry => !isMap(entry) || entry.get("command") !== command);
    }
    if (remove) {
      if (isSeq(entries) && !entries.items.length) document.deleteIn(["hooks", event]);
    } else {
      if (!entries) document.setIn(["hooks", event], document.createNode([]));
      document.addIn(["hooks", event], {
        command,
        timeout: event === "pre_tool_call" ? 300 : 15,
        ...(event === "pre_tool_call" ? { fail_closed: true } : {}),
      });
    }
  }
  if (remove && isMap(document.get("hooks", true)) && !(document.get("hooks", true) as any).items.length) document.delete("hooks");
  const target = path.resolve(cwd, ".hermes/alimbo");
  if (!remove) {
    if (!hooksRoot) throw new Error("Hermes hooks template path is required");
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(path.join(hooksRoot, "scripts/_common.mjs"), path.join(target, "_common.mjs"));
    fs.cpSync(path.join(hooksRoot, "scripts/hermes"), path.join(target, "hermes"), { recursive: true });
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, String(document), { mode: 0o600 });
  if (remove) fs.rmSync(target, { recursive: true, force: true });
  console.log(`[alimbo-hermes] ${remove ? "removed" : "installed"} project hooks: ${configPath}`);
  if (!remove) console.log("[alimbo-hermes] Approve these shell hooks at the Hermes first-use prompt; global auto-accept is not enabled.");
}