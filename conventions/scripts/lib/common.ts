import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export type JsonMap = Record<string, any>;
export type Severity = "info" | "warning" | "error" | "critical";

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  file?: string;
  detail?: any;
}

export interface ScriptResult {
  script_id: string;
  status: "pass" | "fail";
  errors: Issue[];
  warnings: Issue[];
  info: Issue[];
  outputs?: string[];
  summary?: JsonMap;
}

export function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return undefined;
}

export function normalizeRelPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/[;,]+$/g, "").replace(/^['\"]|['\"]$/g, "");
}

export function resolveConventionsRoot(): string {
  const explicit = getArg("root");
  const base = explicit ? path.resolve(explicit) : process.cwd();

  if (fs.existsSync(path.join(base, "conventions", "executors"))) {
    return path.join(base, "conventions");
  }

  if (fs.existsSync(path.join(base, "executors"))) {
    return base;
  }

  if (path.basename(base) === "scripts" && fs.existsSync(path.join(base, "..", "executors"))) {
    return path.resolve(base, "..");
  }

  return base;
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

export function readYamlFile(filePath: string): JsonMap {
  const text = readText(filePath);
  const parsed = YAML.parse(text);
  return parsed ?? {};
}

export function writeYamlFile(filePath: string, value: any): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, YAML.stringify(value), "utf8");
}

export function findFiles(root: string, predicate: (filePath: string) => boolean): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".ai") continue;
        walk(full);
      } else if (entry.isFile() && predicate(full)) {
        results.push(full);
      }
    }
  }
  walk(root);
  return results.sort();
}

export function conventionYamlFiles(root: string): string[] {
  return findFiles(root, file => file.endsWith(".yaml") || file.endsWith(".yml"));
}

export function rel(root: string, filePath: string): string {
  return normalizeRelPath(path.relative(root, filePath));
}

export function asArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean);
}

export function deepFindKey(node: any, key: string, matches: { path: string[]; value: any }[] = [], prefix: string[] = []): { path: string[]; value: any }[] {
  if (Array.isArray(node)) {
    node.forEach((item, index) => deepFindKey(item, key, matches, [...prefix, String(index)]));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) matches.push({ path: [...prefix, k], value: v });
      deepFindKey(v, key, matches, [...prefix, k]);
    }
  }
  return matches;
}

export function flattenExecutorRoutes(routesFile: JsonMap): Map<string, JsonMap> {
  const groups = routesFile?.sections?.executor_routes ?? {};
  const routes = new Map<string, JsonMap>();
  for (const [groupName, groupRoutes] of Object.entries(groups)) {
    if (!groupRoutes || typeof groupRoutes !== "object") continue;
    for (const [routeId, route] of Object.entries(groupRoutes as JsonMap)) {
      if (route && typeof route === "object") {
        routes.set(routeId, { ...(route as JsonMap), route_id: routeId, route_group: groupName });
      }
    }
  }
  return routes;
}

export function readExecutorRoutes(root: string): Map<string, JsonMap> {
  const routesPath = path.join(root, "executors", "conventions.executor-routes.yaml");
  return flattenExecutorRoutes(readYamlFile(routesPath));
}

export function routeIdLooksValid(routeId: string): boolean {
  const pattern = /^([a-z][a-z0-9-]*\.)?[a-z][a-z0-9]*(_[a-z0-9]+)+$/;
  return pattern.test(routeId);
}

export function collectLocalRequiredRoutes(root: string): { file: string; hookPath: string; routes: string[] }[] {
  const results: { file: string; hookPath: string; routes: string[] }[] = [];
  for (const file of conventionYamlFiles(root)) {
    const parsed = readYamlFile(file);
    const matches = deepFindKey(parsed, "required_executor_routes");
    for (const match of matches) {
      const value = match.value;
      if (Array.isArray(value)) {
        results.push({ file: rel(root, file), hookPath: match.path.join("."), routes: asArray(value) });
      } else if (value && typeof value === "object") {
        for (const [hook, list] of Object.entries(value)) {
          results.push({ file: rel(root, file), hookPath: [...match.path, hook].join("."), routes: asArray(list) });
        }
      }
    }
  }
  return results;
}

export function issue(severity: Severity, code: string, message: string, file?: string, detail?: any): Issue {
  return { severity, code, message, file, detail };
}

export function finish(scriptId: string, issues: Issue[], outputs: string[] = [], summary: JsonMap = {}): never {
  const errors = issues.filter(i => i.severity === "error" || i.severity === "critical");
  const warnings = issues.filter(i => i.severity === "warning");
  const info = issues.filter(i => i.severity === "info");
  const result: ScriptResult = {
    script_id: scriptId,
    status: errors.length ? "fail" : "pass",
    errors,
    warnings,
    info,
    outputs,
    summary,
  };
  const root = resolveConventionsRoot();
  writeYamlFile(path.join(root, ".ai", "validation", `${scriptId}.result.yaml`), result);
  console.log(YAML.stringify(result));
  process.exit(errors.length ? 1 : 0);
}

export function extractAiArtifactPathsFromText(text: string): string[] {
  const matches = text.match(/\.ai\/[A-Za-z0-9_./{}*?\-]+[A-Za-z0-9_./{}*?\-]*/g) ?? [];
  return [...new Set(matches.map(normalizeRelPath))].sort();
}
