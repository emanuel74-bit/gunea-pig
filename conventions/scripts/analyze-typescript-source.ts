import fs from "node:fs";
import path from "node:path";
import {
  finish,
  issue,
  readYamlFile,
  resolveConventionsRoot,
  writeYamlFile,
  type Issue,
  type JsonMap,
} from "./lib/common.js";

const SCRIPT_ID = "analyze-typescript-source";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const manifestPath = path.join(root, ".ai", "source-artifacts", "source-artifact-manifest.yaml");

type SourceManifestFile = {
  path: string;
  artifact_kind?: string;
  extension?: string;
  sha256?: string;
  line_count?: number;
};

type TypeScriptAnalysisFile = {
  path: string;
  sha256: string;
  module_kind: "module" | "script";
  line_count: number;
  import_count: number;
  export_count: number;
  import_specifiers: string[];
  re_export_specifiers: string[];
  symbol_hints: {
    class_count: number;
    interface_count: number;
    function_count: number;
    enum_count: number;
    type_alias_count: number;
  };
  evidence_flags: {
    uses_any_keyword: boolean;
    uses_unknown_keyword: boolean;
    has_todo_marker: boolean;
    has_direct_process_env_access: boolean;
  };
};

function asManifestFiles(value: unknown): SourceManifestFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is SourceManifestFile => Boolean(entry) && typeof entry === "object" && typeof (entry as SourceManifestFile).path === "string");
}

function readSourceFile(relativePath: string): string | undefined {
  const normalized = relativePath.replace(/\\/g, "/");
  const abs = normalized.startsWith("conventions/")
    ? path.join(root, normalized.replace(/^conventions\//, ""))
    : path.join(root, "..", normalized);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return undefined;
  return fs.readFileSync(abs, "utf8");
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
  return [...new Set([...text.matchAll(pattern)].map(match => String(match[1] ?? "").trim()).filter(Boolean))].sort();
}

function moduleKind(text: string): "module" | "script" {
  return /\b(import|export)\b/.test(text) ? "module" : "script";
}

if (!fs.existsSync(manifestPath)) {
  issues.push(issue("error", "SOURCE_ARTIFACT_MANIFEST_MISSING", "TypeScript adapter requires .ai/source-artifacts/source-artifact-manifest.yaml. Run collect_source_artifacts first.", ".ai/source-artifacts/source-artifact-manifest.yaml"));
  finish(SCRIPT_ID, issues, [], {
    validation_result: {
      validation_id: SCRIPT_ID,
      status: "failed",
      severity: "error",
      blocking: true,
      issues,
      evidence: [],
      source_script_id: SCRIPT_ID,
      source_status: "fail",
    },
  });
}

const manifest = readYamlFile(manifestPath);
if (manifest.artifact !== "source_artifact_manifest" || !Array.isArray(manifest.files)) {
  issues.push(issue("error", "SOURCE_ARTIFACT_MANIFEST_INVALID", "Source artifact manifest has invalid shape for language adapter consumption.", ".ai/source-artifacts/source-artifact-manifest.yaml"));
}

const manifestFiles = asManifestFiles(manifest.files);
const typescriptFiles = manifestFiles
  .filter(file => file.extension === ".ts" || file.path.endsWith(".ts"))
  .filter(file => !file.path.endsWith(".d.ts"))
  .sort((a, b) => a.path.localeCompare(b.path));

const analyzedFiles: TypeScriptAnalysisFile[] = typescriptFiles.map((file): TypeScriptAnalysisFile | undefined => {
  const text = readSourceFile(file.path);
  if (text === undefined) {
    issues.push(issue("warning", "TYPESCRIPT_SOURCE_FILE_UNREADABLE", `Manifest TypeScript file could not be read: ${file.path}`, file.path));
    return undefined;
  }
  const importSpecifiers = uniqueMatches(text, /\bimport\s+(?:type\s+)?(?:[^'\"]+?\s+from\s+)?["']([^"']+)["']/g);
  const dynamicImportSpecifiers = uniqueMatches(text, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g);
  const exportSpecifiers = uniqueMatches(text, /\bexport\s+[^'\"]*?from\s+["']([^"']+)["']/g);

  return {
    path: file.path,
    sha256: file.sha256 ?? "",
    module_kind: moduleKind(text),
    line_count: file.line_count ?? text.split(/\r?\n/).length,
    import_count: importSpecifiers.length + dynamicImportSpecifiers.length,
    export_count: countMatches(text, /\bexport\b/g),
    import_specifiers: [...new Set([...importSpecifiers, ...dynamicImportSpecifiers])].sort(),
    re_export_specifiers: exportSpecifiers,
    symbol_hints: {
      class_count: countMatches(text, /\bclass\s+[A-Za-z_$][\w$]*/g),
      interface_count: countMatches(text, /\binterface\s+[A-Za-z_$][\w$]*/g),
      function_count: countMatches(text, /\bfunction\s+[A-Za-z_$][\w$]*/g),
      enum_count: countMatches(text, /\benum\s+[A-Za-z_$][\w$]*/g),
      type_alias_count: countMatches(text, /\btype\s+[A-Za-z_$][\w$]*\s*=/g),
    },
    evidence_flags: {
      uses_any_keyword: /\bany\b/.test(text),
      uses_unknown_keyword: /\bunknown\b/.test(text),
      has_todo_marker: /TODO|FIXME/i.test(text),
      has_direct_process_env_access: /\bprocess\.env\b/.test(text),
    },
  };
}).filter((entry): entry is TypeScriptAnalysisFile => entry !== undefined);

const aggregate = analyzedFiles.reduce((acc, file) => {
  const symbolHints = file.symbol_hints as JsonMap;
  acc.import_count += Number(file.import_count ?? 0);
  acc.export_count += Number(file.export_count ?? 0);
  acc.class_count += Number(symbolHints.class_count ?? 0);
  acc.interface_count += Number(symbolHints.interface_count ?? 0);
  acc.function_count += Number(symbolHints.function_count ?? 0);
  acc.enum_count += Number(symbolHints.enum_count ?? 0);
  acc.type_alias_count += Number(symbolHints.type_alias_count ?? 0);
  if ((file.evidence_flags as JsonMap)?.uses_any_keyword) acc.files_using_any += 1;
  if ((file.evidence_flags as JsonMap)?.uses_unknown_keyword) acc.files_using_unknown += 1;
  if ((file.evidence_flags as JsonMap)?.has_todo_marker) acc.files_with_todo += 1;
  if ((file.evidence_flags as JsonMap)?.has_direct_process_env_access) acc.files_with_process_env += 1;
  return acc;
}, {
  import_count: 0,
  export_count: 0,
  class_count: 0,
  interface_count: 0,
  function_count: 0,
  enum_count: 0,
  type_alias_count: 0,
  files_using_any: 0,
  files_using_unknown: 0,
  files_with_todo: 0,
  files_with_process_env: 0,
});

const analysis = {
  artifact: "typescript_source_analysis",
  generated_by: SCRIPT_ID,
  status: analyzedFiles.length ? "analyzed" : "no_matching_files",
  adapter_kind: "language_adapter",
  language: "typescript",
  source_manifest_path: ".ai/source-artifacts/source-artifact-manifest.yaml",
  source_manifest_file_count: manifestFiles.length,
  candidate_file_count: typescriptFiles.length,
  analyzed_file_count: analyzedFiles.length,
  aggregate,
  files: analyzedFiles,
};

const report = {
  artifact: "typescript_adapter_report",
  generated_by: SCRIPT_ID,
  status: issues.some(entry => entry.severity === "error" || entry.severity === "critical") ? "fail" : "pass",
  summary: {
    candidate_file_count: typescriptFiles.length,
    analyzed_file_count: analyzedFiles.length,
    aggregate,
  },
};

const analysisOut = ".ai/source-artifacts/typescript-source-analysis.yaml";
const reportOut = ".ai/reports/typescript-source-analysis-report.yaml";
writeYamlFile(path.join(root, analysisOut), analysis);
writeYamlFile(path.join(root, reportOut), report);

finish(SCRIPT_ID, issues, [analysisOut, reportOut], {
  candidate_file_count: typescriptFiles.length,
  analyzed_file_count: analyzedFiles.length,
  aggregate,
  validation_result: {
    validation_id: SCRIPT_ID,
    status: issues.some(entry => entry.severity === "error" || entry.severity === "critical") ? "failed" : issues.some(entry => entry.severity === "warning") ? "passed_with_warnings" : "passed",
    severity: issues.some(entry => entry.severity === "error" || entry.severity === "critical") ? "error" : issues.some(entry => entry.severity === "warning") ? "warning" : "info",
    blocking: issues.some(entry => entry.severity === "error" || entry.severity === "critical"),
    issues,
    evidence: [
      { evidence_type: "source_artifact_manifest", path: ".ai/source-artifacts/source-artifact-manifest.yaml", producer_route: "collect_source_artifacts" },
      { evidence_type: "language_adapter_analysis", path: analysisOut, producer_route: "analyze_typescript_source" },
    ],
    route_id: "analyze_typescript_source",
    source_script_id: SCRIPT_ID,
    source_status: issues.some(entry => entry.severity === "error" || entry.severity === "critical") ? "fail" : "pass",
  },
});
