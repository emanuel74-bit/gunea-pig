import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { finish, findFiles, normalizeRelPath, readYamlFile, rel, resolveConventionsRoot, writeYamlFile, type Issue, type JsonMap } from "./lib/common.js";

const SCRIPT_ID = "collect-source-artifacts";
const root = resolveConventionsRoot();
const projectRoot = path.resolve(root, "..");
const issues: Issue[] = [];

const includedExtensions = new Set([".yaml", ".yml", ".md", ".ts", ".json"]);
const excludedDirectories = new Set([".ai", ".git", "node_modules", "dist", "build"]);
const excludedFiles = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

type SourceFileRecord = {
  path: string;
  artifact_kind: string;
  extension: string;
  size_bytes: number;
  sha256: string;
  line_count: number;
  yaml_role?: string;
  owned_concepts?: string[];
  declared_executor_routes?: string[];
  route_ids?: string[];
  script_id?: string;
};

type SourceDependencyEdge = {
  from: string;
  to: string;
  edge_type: "yaml_required_file" | "yaml_optional_file" | "executor_route_script" | "claude_route_reference";
};

function shouldInclude(filePath: string): boolean {
  const parts = normalizeRelPath(path.relative(projectRoot, filePath)).split("/");
  if (parts.some(part => excludedDirectories.has(part))) return false;
  if (excludedFiles.has(path.basename(filePath))) return false;
  return includedExtensions.has(path.extname(filePath));
}

function classify(relativePath: string): string {
  if (relativePath.startsWith("conventions/scripts/") && relativePath.endsWith(".ts")) return "runtime_script";
  if (relativePath.startsWith("conventions/") && (relativePath.endsWith(".yaml") || relativePath.endsWith(".yml"))) return "convention_yaml";
  if (relativePath.startsWith(".claude/") || relativePath === "CLAUDE.md") return "claude_native_surface";
  if (relativePath.endsWith(".json")) return "configuration";
  if (relativePath.endsWith(".md")) return "documentation";
  return "source_file";
}

function lineCount(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean) : [];
}

function collectRouteReferences(text: string): string[] {
  const matches = [...text.matchAll(/--route\s+([a-zA-Z0-9_.-]+)/g)].map(match => match[1]);
  return [...new Set(matches)].sort();
}

function collectYamlMetadata(absPath: string, relativePath: string, edges: SourceDependencyEdge[]): Partial<SourceFileRecord> {
  try {
    const doc = readYamlFile(absPath);
    const metadata: Partial<SourceFileRecord> = {};
    if (typeof doc?.file?.role === "string") metadata.yaml_role = doc.file.role;
    const owned = asStringArray(doc?.ownership?.owns);
    if (owned.length) metadata.owned_concepts = owned;

    const required = asStringArray(doc?.dependencies?.required_files);
    const optional = asStringArray(doc?.dependencies?.optional_files);
    for (const target of required) edges.push({ from: relativePath, to: normalizeRelPath(`conventions/${target}`), edge_type: "yaml_required_file" });
    for (const target of optional) edges.push({ from: relativePath, to: normalizeRelPath(`conventions/${target}`), edge_type: "yaml_optional_file" });

    const routeIds: string[] = [];
    const executorRoutes = doc?.sections?.executor_routes;
    if (executorRoutes && typeof executorRoutes === "object" && !Array.isArray(executorRoutes)) {
      for (const groupRoutes of Object.values(executorRoutes as JsonMap)) {
        if (!groupRoutes || typeof groupRoutes !== "object" || Array.isArray(groupRoutes)) continue;
        for (const [routeId, route] of Object.entries(groupRoutes as JsonMap)) {
          routeIds.push(routeId);
          const script = typeof (route as JsonMap)?.script === "string" ? String((route as JsonMap).script) : "";
          if (script) edges.push({ from: relativePath, to: normalizeRelPath(`conventions/${script}`), edge_type: "executor_route_script" });
        }
      }
    }
    if (routeIds.length) metadata.route_ids = [...new Set(routeIds)].sort();
    return metadata;
  } catch {
    return {};
  }
}

function collectCandidateFiles(): string[] {
  const conventionFiles = findFiles(root, shouldInclude);
  const projectFiles: string[] = [];
  const claudeMd = path.join(projectRoot, "CLAUDE.md");
  if (fs.existsSync(claudeMd) && shouldInclude(claudeMd)) projectFiles.push(claudeMd);
  const claudeDir = path.join(projectRoot, ".claude");
  if (fs.existsSync(claudeDir)) projectFiles.push(...findFiles(claudeDir, shouldInclude));
  return [...new Set([...conventionFiles, ...projectFiles])].sort();
}

function sourceRelativePath(file: string): string {
  if (file.startsWith(`${root}${path.sep}`)) return normalizeRelPath(`conventions/${path.relative(root, file)}`);
  return normalizeRelPath(path.relative(projectRoot, file));
}

const files = collectCandidateFiles();
const dependencyEdges: SourceDependencyEdge[] = [];
const records: SourceFileRecord[] = files.map(file => {
  const relativePath = sourceRelativePath(file);
  const text = fs.readFileSync(file, "utf8");
  const stat = fs.statSync(file);
  const record: SourceFileRecord = {
    path: relativePath,
    artifact_kind: classify(relativePath),
    extension: path.extname(file),
    size_bytes: stat.size,
    sha256: crypto.createHash("sha256").update(text).digest("hex"),
    line_count: lineCount(text),
  };

  if (record.artifact_kind === "convention_yaml") Object.assign(record, collectYamlMetadata(file, relativePath, dependencyEdges));
  if (record.artifact_kind === "claude_native_surface") {
    const routes = collectRouteReferences(text);
    if (routes.length) {
      record.declared_executor_routes = routes;
      for (const routeId of routes) dependencyEdges.push({ from: relativePath, to: routeId, edge_type: "claude_route_reference" });
    }
  }
  if (record.artifact_kind === "runtime_script") record.script_id = path.basename(file).replace(/\.ts$/, "");
  return record;
}).sort((a, b) => a.path.localeCompare(b.path));

const uniqueEdges = [...new Map(dependencyEdges.map(edge => [`${edge.from}|${edge.to}|${edge.edge_type}`, edge])).values()]
  .sort((a, b) => `${a.from}${a.to}${a.edge_type}`.localeCompare(`${b.from}${b.to}${b.edge_type}`));

const byKind = records.reduce<Record<string, number>>((acc, record) => {
  acc[record.artifact_kind] = (acc[record.artifact_kind] ?? 0) + 1;
  return acc;
}, {});

const manifest = {
  artifact: "source_artifact_manifest",
  generated_by: SCRIPT_ID,
  status: "collected",
  source_root: "conventions",
  collection_scope: {
    included_extensions: [...includedExtensions].sort(),
    excluded_directories: [...excludedDirectories].sort(),
    excluded_files: [...excludedFiles].sort(),
  },
  source_file_count: records.length,
  dependency_edge_count: uniqueEdges.length,
  source_files_by_kind: byKind,
  files: records,
  dependency_edges: uniqueEdges,
};

const report = {
  artifact: "source_collection_report",
  generated_by: SCRIPT_ID,
  status: "pass",
  summary: {
    source_file_count: records.length,
    dependency_edge_count: uniqueEdges.length,
    source_files_by_kind: byKind,
  },
};

writeYamlFile(path.join(root, ".ai", "source-artifacts", "source-artifact-manifest.yaml"), manifest);
writeYamlFile(path.join(root, ".ai", "reports", "source-collection-report.yaml"), report);

finish(SCRIPT_ID, issues, [".ai/source-artifacts/source-artifact-manifest.yaml", ".ai/reports/source-collection-report.yaml"], {
  source_file_count: records.length,
  dependency_edge_count: uniqueEdges.length,
  source_files_by_kind: byKind,
});
