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
  if (process.env.SCRIPT_RESULT_STDOUT !== "suppress") {
    console.log(YAML.stringify(result));
  }
  process.exit(errors.length ? 1 : 0);
}


export function globToRegExp(glob: string): RegExp {
  const normalized = normalizeRelPath(glob);
  let regex = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      regex += ".*";
      index += 1;
    } else if (char === "*") {
      regex += "[^/]*";
    } else if (char === "?") {
      regex += ".";
    } else if (".+^${}()|[]\\".includes(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }
  return new RegExp(`^${regex}$`);
}

export function globMatches(glob: string, candidate: string): boolean {
  return globToRegExp(glob).test(normalizeRelPath(candidate));
}

export function isRuntimeArtifactPath(value: string): boolean {
  return normalizeRelPath(value).startsWith(".ai/");
}

export function isGlobPath(value: string): boolean {
  return value.includes("*") || value.includes("{") || value.includes("}");
}


export function isJsonMap(value: unknown): value is JsonMap {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseStructuredOutput(text: string): JsonMap | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return isJsonMap(parsed) ? parsed : undefined;
  } catch {
    try {
      const parsed = YAML.parse(trimmed);
      return isJsonMap(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}

export function expectedScriptIdFromRoute(route: JsonMap): string {
  const script = typeof route.script === "string" ? route.script : "";
  const base = path.basename(script).replace(/\.ts$/, "");
  return base || String(route.route_id ?? "");
}

export function removeRouteArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === "--route") {
      index += 1;
      continue;
    }
    if (current.startsWith("--route=")) continue;
    out.push(current);
  }
  return out;
}

export interface RuntimeArtifactDeclaration {
  artifact_id: string;
  path: string;
  artifact_type?: string;
  schema?: string;
  producer?: string;
  producer_routes?: string[];
  consumers?: string[];
  scope?: string;
  lifecycle?: string;
  write_mode?: string;
  required?: string | boolean;
  declared_by: string;
}

export function collectRuntimeArtifactDeclarations(root: string): RuntimeArtifactDeclaration[] {
  const declarations: RuntimeArtifactDeclaration[] = [];
  for (const file of conventionYamlFiles(root)) {
    const parsed = readYamlFile(file);
    const registry = parsed?.sections?.runtime_artifact_registry;
    if (!Array.isArray(registry)) continue;
    for (const entry of registry) {
      if (!entry || typeof entry !== "object") continue;
      const artifactId = typeof entry.artifact_id === "string" ? entry.artifact_id.trim() : "";
      const artifactPath = typeof entry.path === "string" ? normalizeRelPath(entry.path) : "";
      if (!artifactId || !artifactPath) continue;
      declarations.push({
        ...(entry as JsonMap),
        artifact_id: artifactId,
        path: artifactPath,
        producer_routes: asArray((entry as JsonMap).producer_routes),
        consumers: asArray((entry as JsonMap).consumers),
        declared_by: rel(root, file),
      });
    }
  }
  return declarations.sort((a, b) => a.artifact_id.localeCompare(b.artifact_id));
}

export function routeAllowsArtifact(route: JsonMap, artifactPath: string): boolean {
  const allowed = asArray(route.allowed_write_paths);
  return allowed.some(pattern => globMatches(pattern, artifactPath) || normalizeRelPath(pattern) === normalizeRelPath(artifactPath));
}

export function extractRawAiArtifactPathsFromText(text: string): string[] {
  const matches = text.match(/["']?\.ai\/[A-Za-z0-9_./{}*?\-]+[A-Za-z0-9_./{}*?\-]*[;,]?["']?/g) ?? [];
  return [...new Set(matches)].sort();
}

export function extractAiArtifactPathsFromText(text: string): string[] {
  const matches = text.match(/\.ai\/[A-Za-z0-9_./{}*?\-]+[A-Za-z0-9_./{}*?\-]*/g) ?? [];
  return [...new Set(matches.map(normalizeRelPath))].sort();
}

export interface ValidationDecision {
  validation_id?: string;
  status: string;
  severity?: Severity | string;
  blocking: boolean;
  source_shape: "universal" | "normalized_summary" | "legacy_script_result" | "unknown";
}

export function extractValidationDecision(doc: JsonMap): ValidationDecision {
  const normalized = isJsonMap(doc?.summary?.normalized_result) ? doc.summary.normalized_result as JsonMap : undefined;
  const source = normalized ?? doc;

  if (normalized && typeof normalized.status === "string") {
    return {
      validation_id: typeof normalized.validation_id === "string" ? normalized.validation_id : undefined,
      status: normalized.status,
      severity: typeof normalized.severity === "string" ? normalized.severity : undefined,
      blocking: normalized.blocking === true || ["failed", "blocked"].includes(String(normalized.status)),
      source_shape: "normalized_summary",
    };
  }

  if (typeof source.validation_id === "string" && typeof source.status === "string") {
    return {
      validation_id: source.validation_id,
      status: source.status,
      severity: typeof source.severity === "string" ? source.severity : undefined,
      blocking: source.blocking === true || ["failed", "blocked"].includes(String(source.status)),
      source_shape: "universal",
    };
  }

  if (typeof source.script_id === "string" && typeof source.status === "string") {
    const errors = Array.isArray(source.errors) ? source.errors : [];
    const criticalOrError = errors.some((entry: any) => ["error", "critical"].includes(String(entry?.severity)));
    return {
      validation_id: source.script_id,
      status: source.status,
      severity: criticalOrError ? "error" : Array.isArray(source.warnings) && source.warnings.length ? "warning" : "info",
      blocking: source.status === "fail" || criticalOrError,
      source_shape: "legacy_script_result",
    };
  }

  return { status: "unknown", blocking: false, source_shape: "unknown" };
}
