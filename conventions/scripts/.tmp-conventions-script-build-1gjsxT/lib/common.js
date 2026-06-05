import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
export function getArg(name) {
    const index = process.argv.indexOf(`--${name}`);
    if (index >= 0 && process.argv[index + 1])
        return process.argv[index + 1];
    return undefined;
}
export function normalizeRelPath(value) {
    return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/[;,]+$/g, "").replace(/^['\"]|['\"]$/g, "");
}
export function resolveConventionsRoot() {
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
export function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}
export function readText(filePath) {
    return fs.readFileSync(filePath, "utf8");
}
export function readYamlFile(filePath) {
    const text = readText(filePath);
    const parsed = YAML.parse(text);
    return parsed ?? {};
}
export function writeYamlFile(filePath, value) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, YAML.stringify(value), "utf8");
}
export function findFiles(root, predicate) {
    const results = [];
    function walk(dir) {
        if (!fs.existsSync(dir))
            return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".ai")
                    continue;
                walk(full);
            }
            else if (entry.isFile() && predicate(full)) {
                results.push(full);
            }
        }
    }
    walk(root);
    return results.sort();
}
export function conventionYamlFiles(root) {
    return findFiles(root, file => file.endsWith(".yaml") || file.endsWith(".yml"));
}
export function rel(root, filePath) {
    return normalizeRelPath(path.relative(root, filePath));
}
export function asArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean);
}
export function deepFindKey(node, key, matches = [], prefix = []) {
    if (Array.isArray(node)) {
        node.forEach((item, index) => deepFindKey(item, key, matches, [...prefix, String(index)]));
    }
    else if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
            if (k === key)
                matches.push({ path: [...prefix, k], value: v });
            deepFindKey(v, key, matches, [...prefix, k]);
        }
    }
    return matches;
}
export function flattenExecutorRoutes(routesFile) {
    const groups = routesFile?.sections?.executor_routes ?? {};
    const routes = new Map();
    for (const [groupName, groupRoutes] of Object.entries(groups)) {
        if (!groupRoutes || typeof groupRoutes !== "object")
            continue;
        for (const [routeId, route] of Object.entries(groupRoutes)) {
            if (route && typeof route === "object") {
                routes.set(routeId, { ...route, route_id: routeId, route_group: groupName });
            }
        }
    }
    return routes;
}
export function readExecutorRoutes(root) {
    const routesPath = path.join(root, "executors", "conventions.executor-routes.yaml");
    return flattenExecutorRoutes(readYamlFile(routesPath));
}
export function routeIdLooksValid(routeId) {
    const pattern = /^([a-z][a-z0-9-]*\.)?[a-z][a-z0-9]*(_[a-z0-9]+)+$/;
    return pattern.test(routeId);
}
export function collectLocalRequiredRoutes(root) {
    const results = [];
    for (const file of conventionYamlFiles(root)) {
        const parsed = readYamlFile(file);
        const matches = deepFindKey(parsed, "required_executor_routes");
        for (const match of matches) {
            const value = match.value;
            if (Array.isArray(value)) {
                results.push({ file: rel(root, file), hookPath: match.path.join("."), routes: asArray(value) });
            }
            else if (value && typeof value === "object") {
                for (const [hook, list] of Object.entries(value)) {
                    results.push({ file: rel(root, file), hookPath: [...match.path, hook].join("."), routes: asArray(list) });
                }
            }
        }
    }
    return results;
}
export function issue(severity, code, message, file, detail) {
    return { severity, code, message, file, detail };
}
export function finish(scriptId, issues, outputs = [], summary = {}) {
    const errors = issues.filter(i => i.severity === "error" || i.severity === "critical");
    const warnings = issues.filter(i => i.severity === "warning");
    const info = issues.filter(i => i.severity === "info");
    const result = {
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
export function globToRegExp(glob) {
    const normalized = normalizeRelPath(glob);
    let regex = "";
    for (let index = 0; index < normalized.length; index += 1) {
        const char = normalized[index];
        const next = normalized[index + 1];
        if (char === "*" && next === "*") {
            regex += ".*";
            index += 1;
        }
        else if (char === "*") {
            regex += "[^/]*";
        }
        else if (char === "?") {
            regex += ".";
        }
        else if (".+^${}()|[]\\".includes(char)) {
            regex += `\\${char}`;
        }
        else {
            regex += char;
        }
    }
    return new RegExp(`^${regex}$`);
}
export function globMatches(glob, candidate) {
    return globToRegExp(glob).test(normalizeRelPath(candidate));
}
export function isRuntimeArtifactPath(value) {
    return normalizeRelPath(value).startsWith(".ai/");
}
export function isGlobPath(value) {
    return value.includes("*") || value.includes("{") || value.includes("}");
}
export function collectRuntimeArtifactDeclarations(root) {
    const declarations = [];
    for (const file of conventionYamlFiles(root)) {
        const parsed = readYamlFile(file);
        const registry = parsed?.sections?.runtime_artifact_registry;
        if (!Array.isArray(registry))
            continue;
        for (const entry of registry) {
            if (!entry || typeof entry !== "object")
                continue;
            const artifactId = typeof entry.artifact_id === "string" ? entry.artifact_id.trim() : "";
            const artifactPath = typeof entry.path === "string" ? normalizeRelPath(entry.path) : "";
            if (!artifactId || !artifactPath)
                continue;
            declarations.push({
                ...entry,
                artifact_id: artifactId,
                path: artifactPath,
                producer_routes: asArray(entry.producer_routes),
                consumers: asArray(entry.consumers),
                declared_by: rel(root, file),
            });
        }
    }
    return declarations.sort((a, b) => a.artifact_id.localeCompare(b.artifact_id));
}
export function routeAllowsArtifact(route, artifactPath) {
    const allowed = asArray(route.allowed_write_paths);
    return allowed.some(pattern => globMatches(pattern, artifactPath) || normalizeRelPath(pattern) === normalizeRelPath(artifactPath));
}
export function extractRawAiArtifactPathsFromText(text) {
    const matches = text.match(/["']?\.ai\/[A-Za-z0-9_./{}*?\-]+[A-Za-z0-9_./{}*?\-]*[;,]?["']?/g) ?? [];
    return [...new Set(matches)].sort();
}
export function extractAiArtifactPathsFromText(text) {
    const matches = text.match(/\.ai\/[A-Za-z0-9_./{}*?\-]+[A-Za-z0-9_./{}*?\-]*/g) ?? [];
    return [...new Set(matches.map(normalizeRelPath))].sort();
}
