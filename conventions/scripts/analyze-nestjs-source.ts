import fs from "node:fs";
import path from "node:path";
import {
  buildUniversalValidationResult,
  finish,
  issue,
  readYamlFile,
  resolveConventionsRoot,
  writeYamlFile,
  type Issue,
  type JsonMap,
} from "./lib/common.js";

const SCRIPT_ID = "analyze-nestjs-source";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const languageAnalysisPath = path.join(root, ".ai", "source-artifacts", "typescript-source-analysis.yaml");

type TypeScriptAnalysisFile = {
  path: string;
  module_kind?: string;
  import_specifiers?: string[];
  symbol_hints?: JsonMap;
};

type NestJsAnalysisFile = {
  path: string;
  decorators: string[];
  provider_indicators: string[];
  controller_indicators: string[];
  module_indicators: string[];
  injection_indicators: string[];
  evidence_flags: {
    has_nestjs_import: boolean;
    has_module_decorator: boolean;
    has_controller_decorator: boolean;
    has_injectable_decorator: boolean;
    has_constructor_injection: boolean;
  };
};

function asTypeScriptFiles(value: unknown): TypeScriptAnalysisFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is TypeScriptAnalysisFile => Boolean(entry) && typeof entry === "object" && typeof (entry as TypeScriptAnalysisFile).path === "string");
}

function readSourceFile(relativePath: string): string | undefined {
  const normalized = relativePath.replace(/\\/g, "/");
  const abs = normalized.startsWith("conventions/")
    ? path.join(root, normalized.replace(/^conventions\//, ""))
    : path.join(root, "..", normalized);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return undefined;
  return fs.readFileSync(abs, "utf8");
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
  return [...new Set([...text.matchAll(pattern)].map(match => String(match[1] ?? match[0] ?? "").trim()).filter(Boolean))].sort();
}

function hasNestImport(file: TypeScriptAnalysisFile, text: string): boolean {
  const specifiers = Array.isArray(file.import_specifiers) ? file.import_specifiers : [];
  return specifiers.some(specifier => specifier.startsWith("@nestjs/")) || /["']@nestjs\//.test(text);
}

if (!fs.existsSync(languageAnalysisPath)) {
  issues.push(issue("error", "TYPESCRIPT_SOURCE_ANALYSIS_MISSING", "NestJS framework adapter requires .ai/source-artifacts/typescript-source-analysis.yaml. Run analyze_typescript_source first.", ".ai/source-artifacts/typescript-source-analysis.yaml"));
  finish(SCRIPT_ID, issues, [], {
    validation_result: buildUniversalValidationResult(SCRIPT_ID, issues, {
      route_id: "analyze_nestjs_source",
      evidence: [],
    }),
  });
}

const languageAnalysis = readYamlFile(languageAnalysisPath);
if (languageAnalysis.artifact !== "typescript_source_analysis" || !Array.isArray(languageAnalysis.files)) {
  issues.push(issue("error", "TYPESCRIPT_SOURCE_ANALYSIS_INVALID", "TypeScript source analysis has invalid shape for framework adapter consumption.", ".ai/source-artifacts/typescript-source-analysis.yaml"));
}

const tsFiles = asTypeScriptFiles(languageAnalysis.files);
const analyzedFiles: NestJsAnalysisFile[] = tsFiles.map((file): NestJsAnalysisFile | undefined => {
  const text = readSourceFile(file.path);
  if (text === undefined) {
    issues.push(issue("warning", "NESTJS_SOURCE_FILE_UNREADABLE", `TypeScript analysis file could not be read: ${file.path}`, file.path));
    return undefined;
  }
  const decorators = uniqueMatches(text, /@(Module|Controller|Injectable|Inject|Get|Post|Put|Patch|Delete)\b/g).map(name => `@${name}`);
  const hasNest = hasNestImport(file, text) || decorators.length > 0;
  if (!hasNest) return undefined;

  return {
    path: file.path,
    decorators,
    provider_indicators: [
      ...(/@Injectable\b/.test(text) ? ["@Injectable"] : []),
      ...(/\bproviders\s*:/.test(text) ? ["module_providers_array"] : []),
    ],
    controller_indicators: [
      ...(/@Controller\b/.test(text) ? ["@Controller"] : []),
      ...(/\bcontrollers\s*:/.test(text) ? ["module_controllers_array"] : []),
    ],
    module_indicators: [
      ...(/@Module\b/.test(text) ? ["@Module"] : []),
      ...(/\bimports\s*:/.test(text) ? ["module_imports_array"] : []),
      ...(/\bexports\s*:/.test(text) ? ["module_exports_array"] : []),
    ],
    injection_indicators: [
      ...(/constructor\s*\([^)]*(private|protected|public|readonly)\s+\w+\s*:/s.test(text) ? ["constructor_parameter_property_injection"] : []),
      ...(/@Inject\b/.test(text) ? ["@Inject"] : []),
    ],
    evidence_flags: {
      has_nestjs_import: hasNestImport(file, text),
      has_module_decorator: /@Module\b/.test(text),
      has_controller_decorator: /@Controller\b/.test(text),
      has_injectable_decorator: /@Injectable\b/.test(text),
      has_constructor_injection: /constructor\s*\([^)]*(private|protected|public|readonly)\s+\w+\s*:/s.test(text),
    },
  };
}).filter((entry): entry is NestJsAnalysisFile => entry !== undefined).sort((a, b) => a.path.localeCompare(b.path));

const aggregate = analyzedFiles.reduce((acc, file) => {
  if (file.evidence_flags.has_module_decorator) acc.module_file_count += 1;
  if (file.evidence_flags.has_controller_decorator) acc.controller_file_count += 1;
  if (file.evidence_flags.has_injectable_decorator) acc.injectable_file_count += 1;
  if (file.evidence_flags.has_constructor_injection) acc.constructor_injection_file_count += 1;
  acc.decorator_count += file.decorators.length;
  return acc;
}, {
  module_file_count: 0,
  controller_file_count: 0,
  injectable_file_count: 0,
  constructor_injection_file_count: 0,
  decorator_count: 0,
});

const analysisOut = ".ai/source-artifacts/nestjs-source-analysis.yaml";
const reportOut = ".ai/reports/nestjs-source-analysis-report.yaml";
const status = issues.some(entry => entry.severity === "error" || entry.severity === "critical")
  ? "failed"
  : analyzedFiles.length ? "analyzed" : "no_framework_files";

const analysis = {
  artifact: "nestjs_source_analysis",
  generated_by: SCRIPT_ID,
  status,
  adapter_kind: "framework_adapter",
  framework: "nestjs",
  language_analysis_path: ".ai/source-artifacts/typescript-source-analysis.yaml",
  language_file_count: tsFiles.length,
  detected_file_count: analyzedFiles.length,
  analyzed_file_count: analyzedFiles.length,
  aggregate,
  files: analyzedFiles,
};

const report = {
  artifact: "nestjs_adapter_report",
  generated_by: SCRIPT_ID,
  status: issues.some(entry => entry.severity === "error" || entry.severity === "critical") ? "fail" : "pass",
  summary: {
    language_file_count: tsFiles.length,
    detected_file_count: analyzedFiles.length,
    analyzed_file_count: analyzedFiles.length,
    aggregate,
  },
};

writeYamlFile(path.join(root, analysisOut), analysis);
writeYamlFile(path.join(root, reportOut), report);

finish(SCRIPT_ID, issues, [analysisOut, reportOut], {
  language_file_count: tsFiles.length,
  detected_file_count: analyzedFiles.length,
  analyzed_file_count: analyzedFiles.length,
  aggregate,
  validation_result: buildUniversalValidationResult(SCRIPT_ID, issues, {
    route_id: "analyze_nestjs_source",
    evidence: [
      { evidence_type: "language_adapter_analysis", path: ".ai/source-artifacts/typescript-source-analysis.yaml", producer_route: "analyze_typescript_source" },
      { evidence_type: "framework_adapter_analysis", path: analysisOut, producer_route: "analyze_nestjs_source" },
    ],
    summary: { detected_file_count: analyzedFiles.length, analyzed_file_count: analyzedFiles.length },
  }),
});
