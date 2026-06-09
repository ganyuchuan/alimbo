import { safeStringify, truncateString } from "./common.js";

function parseHintArgs(toolArgs: unknown) {
  if (!toolArgs) {
    return {};
  }

  if (typeof toolArgs === "string") {
    try {
      return JSON.parse(toolArgs);
    } catch {
      return {};
    }
  }

  if (typeof toolArgs === "object") {
    return toolArgs as Record<string, unknown>;
  }

  return {};
}

function toHintValue(value: unknown) {
  return String(value ?? "").trim();
}

function getFirstField(args: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = args[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return value;
    }
  }
  return "";
}

function buildReadHint(toolArgs: unknown) {
  const args = parseHintArgs(toolArgs);
  const pathValue = toHintValue(getFirstField(args, ["path", "file_path", "filePath"]));
  const rangeValue = getFirstField(args, ["view_range", "viewRange", "range", "line_range"]);

  if (Array.isArray(rangeValue) && rangeValue.length > 0) {
    const rangeText = toHintValue(JSON.stringify(rangeValue));
    return pathValue ? `${pathValue} ${rangeText}` : rangeText;
  }

  const startLine = getFirstField(args, ["start_line", "startLine"]);
  const endLine = getFirstField(args, ["end_line", "endLine"]);
  if (startLine && endLine) {
    const lineRange = `[${startLine},${endLine}]`;
    return pathValue ? `${pathValue} ${lineRange}` : lineRange;
  }

  return pathValue;
}

function buildBashHint(toolArgs: unknown) {
  const args = parseHintArgs(toolArgs);
  const commandValue = toHintValue(getFirstField(args, ["command", "cmd"]));
  const descriptionValue = toHintValue(getFirstField(args, ["description", "goal", "explanation"]));

  if (commandValue && descriptionValue) {
    return `${commandValue}\n${descriptionValue}`;
  }

  return commandValue || descriptionValue;
}

function extractPatchBody(toolArgs: unknown) {
  const text = String(toolArgs ?? "");
  const beginMarker = "*** Begin Patch";
  const endMarker = "*** End Patch";
  const beginIndex = text.indexOf(beginMarker);
  const endIndex = text.lastIndexOf(endMarker);

  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    return toHintValue(text);
  }

  const start = beginIndex + beginMarker.length;
  const body = text.slice(start, endIndex).trim();
  return toHintValue(body);
}

export function buildPreToolInterceptHint(toolName: unknown, toolArgs: unknown, logPrefix = "") {
  const normalizedTool = String(toolName ?? "").trim().toLowerCase();
  const argsSummary = truncateString(
    typeof toolArgs === "string"
      ? `string(len=${toolArgs.length}) ${toolArgs}`
      : safeStringify(toolArgs, "{}"),
    120,
  );

  let hint = "";
  let strategy = "fallback";

  if (normalizedTool === "view" || normalizedTool === "read") {
    strategy = "read";
    hint = buildReadHint(toolArgs);
  } else if (normalizedTool === "bash") {
    strategy = "bash";
    hint = buildBashHint(toolArgs);
  } else if (normalizedTool === "apply_patch") {
    strategy = "apply_patch";
    hint = extractPatchBody(toolArgs);
  }

  if (!hint) {
    hint = toHintValue(safeStringify(toolArgs, "{}"));
  }

  if (logPrefix) {
    console.log(
      `${logPrefix} tool=${normalizedTool || "-"} strategy=${strategy} args=${argsSummary} hint=${JSON.stringify(hint)}`,
    );
  }

  return hint;
}
