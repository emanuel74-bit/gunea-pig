import fs from "node:fs";
import path from "node:path";
import {
  buildUniversalValidationResult,
  finish,
  findFiles,
  issue,
  readExecutorRoutes,
  readYamlFile,
  resolveConventionsRoot,
  writeYamlFile,
  type Issue,
  type JsonMap,
} from "./lib/common.js";

const SCRIPT_ID = "analyze-prompt-contracts";
const ROUTE_ID = "analyze_prompt_contracts";
const root = resolveConventionsRoot();
const projectRoot = path.dirname(root);
const issues: Issue[] = [];

const contractSections = [
  "purpose",
  "authority_boundary",
  "required_inputs",
  "allowed_outputs",
  "forbidden_actions",
  "route_dependencies",
  "completion_condition",
] as const;

type ContractSection = typeof contractSections[number];

type PromptCategory = "project_entrypoint" | "command" | "skill" | "agent" | "hook_documentation" | "claude_convention";

interface PromptSurface {
  path: string;
  absolutePath: string;
  category: PromptCategory;
  text: string;
}

function normalizeRel(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function relProject(filePath: string): string {
  return normalizeRel(path.relative(projectRoot, filePath));
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(projectRoot, relPath));
}

function readTextSafe(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function collectPromptSurfaces(): PromptSurface[] {
  const surfaces: PromptSurface[] = [];

  const claudeMd = path.join(projectRoot, "CLAUDE.md");
  if (fs.existsSync(claudeMd)) {
    surfaces.push({ path: "CLAUDE.md", absolutePath: claudeMd, category: "project_entrypoint", text: readTextSafe(claudeMd) });
  }

  const addMarkdownDir = (relDir: string, category: PromptCategory, predicate: (file: string) => boolean): void => {
    const dir = path.join(projectRoot, relDir);
    for (const file of findFiles(dir, candidate => predicate(candidate))) {
      surfaces.push({ path: relProject(file), absolutePath: file, category, text: readTextSafe(file) });
    }
  };

  addMarkdownDir(".claude/commands", "command", file => file.endsWith(".md"));
  addMarkdownDir(".claude/skills", "skill", file => file.endsWith("SKILL.md"));
  addMarkdownDir(".claude/agents", "agent", file => file.endsWith(".md"));
  addMarkdownDir(".claude/hooks", "hook_documentation", file => file.endsWith(".md"));

  const claudeCodeDir = path.join(root, "claude-code");
  for (const file of findFiles(claudeCodeDir, candidate => candidate.endsWith(".yaml") || candidate.endsWith(".yml"))) {
    surfaces.push({ path: relProject(file), absolutePath: file, category: "claude_convention", text: readTextSafe(file) });
  }

  return surfaces.sort((a, b) => a.path.localeCompare(b.path));
}

function textHas(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

function sectionCoverage(surface: PromptSurface): Record<ContractSection, boolean> {
  const text = surface.text.toLowerCase();
  const coverage: Record<ContractSection, boolean> = {
    purpose: textHas(text, [/\bpurpose\b/, /\bobjective\b/, /\brole\b/, /\btask\b/]),
    authority_boundary: textHas(text, [/authority/, /\bmust not\b/, /\bdo not\b/, /forbidden/, /allowed/, /boundary/]),
    required_inputs: textHas(text, [/required input/, /inputs?:/, /arguments?/, /requires?\b/, /mission_id/, /phase_id/, /artifact/]),
    allowed_outputs: textHas(text, [/allowed output/, /outputs?:/, /produces?\b/, /writes?\b/, /artifacts?/, /report/]),
    forbidden_actions: textHas(text, [/forbidden/, /\bmust not\b/, /\bdo not\b/, /never\b/, /not allowed/, /cannot/]),
    route_dependencies: textHas(text, [/invoke:route/, /invoke_route/, /route_id/, /executor route/, /--route\s+[a-z0-9_]+/]),
    completion_condition: textHas(text, [/completion/, /complete(d|s)?\b/, /done\b/, /stop condition/, /exit criteria/, /success condition/]),
  };
  return coverage;
}

function detectedRouteIds(text: string): string[] {
  const ids = new Set<string>();
  const patterns = [
    /--route\s+([a-z][a-z0-9]*_[a-z0-9_]+)/g,
    /route_id:\s*([a-z][a-z0-9]*_[a-z0-9_]+)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) ids.add(match[1]);
  }
  return [...ids].sort();
}

function directScriptReferences(text: string): string[] {
  const refs = new Set<string>();
  const pattern = /(?:scripts\/|conventions\/scripts\/)([a-z0-9-]+\.ts)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) refs.add(match[0]);
  return [...refs].sort();
}

const routes = readExecutorRoutes(root);
const surfaces = collectPromptSurfaces();
if (surfaces.length === 0) {
  issues.push(issue("error", "PROMPT_SURFACES_MISSING", "No Claude-facing prompt surfaces were found for prompt contract analysis.", ".claude/"));
}
if (!fileExists("conventions/prompts/conventions.prompt-contract-standardization.yaml")) {
  issues.push(issue("error", "PROMPT_CONTRACT_STANDARD_MISSING", "Prompt contract standardization convention is missing.", "conventions/prompts/conventions.prompt-contract-standardization.yaml"));
}

const surfaceAnalyses = surfaces.map(surface => {
  const coverage = sectionCoverage(surface);
  const missing_sections = contractSections.filter(section => !coverage[section]);
  for (const section of missing_sections) {
    issues.push(issue("warning", "PROMPT_CONTRACT_SECTION_MISSING", `Prompt surface is missing detectable ${section} contract coverage.`, surface.path, { category: surface.category, section }));
  }

  const route_ids = detectedRouteIds(surface.text);
  const unknown_routes = route_ids.filter(routeId => !routes.has(routeId));
  for (const routeId of unknown_routes) {
    issues.push(issue("error", "PROMPT_CONTRACT_UNKNOWN_ROUTE", "Prompt surface references an unknown executor route.", surface.path, { route_id: routeId }));
  }

  const direct_script_references = directScriptReferences(surface.text);
  for (const scriptReference of direct_script_references) {
    issues.push(issue("warning", "PROMPT_DIRECT_SCRIPT_REFERENCE", "Prompt surface references a script path directly; Claude-facing runtime actions should use executor routes.", surface.path, { script_reference: scriptReference }));
  }

  return {
    path: surface.path,
    category: surface.category,
    line_count: surface.text.split(/\r?\n/).length,
    contract_coverage: coverage,
    covered_section_count: contractSections.filter(section => coverage[section]).length,
    missing_sections,
    detected_route_ids: route_ids,
    unknown_route_ids: unknown_routes,
    direct_script_references,
  };
});

const categoryCounts = surfaceAnalyses.reduce<Record<string, number>>((acc, entry) => {
  acc[entry.category] = (acc[entry.category] ?? 0) + 1;
  return acc;
}, {});
const totalMissingSections = surfaceAnalyses.reduce((sum, entry) => sum + entry.missing_sections.length, 0);
const surfacesWithCompleteContract = surfaceAnalyses.filter(entry => entry.missing_sections.length === 0).length;
const promptContractOut = ".ai/prompt-contracts/prompt-contract-analysis.yaml";
const reportOut = ".ai/reports/prompt-contract-report.yaml";
const blockingDecision = issues.some(entry => entry.severity === "error" || entry.severity === "critical");
const validationResult = buildUniversalValidationResult(SCRIPT_ID, issues, {
  route_id: ROUTE_ID,
  evidence: [
    {
      evidence_type: "prompt_contract_analysis",
      path: promptContractOut,
      evidence_ref: promptContractOut,
      prompt_surface_count: surfaceAnalyses.length,
      total_missing_sections: totalMissingSections,
    },
  ],
  summary: {
    rollout_mode: "observe",
    enforcement_mode: "observe",
    blocking_decision: blockingDecision,
    prompt_surface_count: surfaceAnalyses.length,
    total_missing_sections: totalMissingSections,
  },
});

const analysis = {
  artifact: "prompt_contract_analysis",
  generated_by: SCRIPT_ID,
  route_id: ROUTE_ID,
  schema_version: "1.0",
  rollout_mode: "observe",
  enforcement_mode: "observe",
  mutation_allowed: false,
  prompt_rewrite_allowed: false,
  blocking_decision: blockingDecision,
  contract_model: {
    required_sections: [...contractSections],
    missing_sections_behavior: "warning_only",
    unknown_route_behavior: "error",
    direct_script_reference_behavior: "warning",
  },
  summary: {
    prompt_surface_count: surfaceAnalyses.length,
    surfaces_with_complete_contract: surfacesWithCompleteContract,
    total_missing_sections: totalMissingSections,
    category_counts: categoryCounts,
    warning_count: issues.filter(entry => entry.severity === "warning").length,
    error_count: issues.filter(entry => entry.severity === "error" || entry.severity === "critical").length,
  },
  prompt_surfaces: surfaceAnalyses,
};

const report = {
  artifact: "prompt_contract_report",
  generated_by: SCRIPT_ID,
  status: blockingDecision ? "fail" : issues.some(entry => entry.severity === "warning") ? "pass_with_warnings" : "pass",
  summary: analysis.summary,
  validation_result: validationResult,
};

writeYamlFile(path.join(root, promptContractOut), analysis);
writeYamlFile(path.join(root, reportOut), report);
finish(SCRIPT_ID, issues, [promptContractOut, reportOut], {
  prompt_contract_analysis: analysis.summary,
  validation_result: validationResult,
});
