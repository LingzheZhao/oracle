import fs from "node:fs/promises";
import path from "node:path";
import { getOracleHomeDir } from "../oracleHome.js";
import type { SessionArtifact } from "../sessionStore.js";
import type { BrowserLogger } from "./types.js";

const ARTIFACTS_DIRNAME = "artifacts";

function sanitizePathSegment(value: string, fallback: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return sanitized || fallback;
}

function normalizeSessionId(sessionId: string): string {
  return sanitizePathSegment(path.basename(sessionId), "session");
}

export function resolveSessionArtifactsDir(sessionId: string): string {
  return path.join(
    getOracleHomeDir(),
    "sessions",
    normalizeSessionId(sessionId),
    ARTIFACTS_DIRNAME,
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveUniquePath(basePath: string): Promise<string> {
  const ext = path.extname(basePath);
  const stem = ext ? path.basename(basePath, ext) : path.basename(basePath);
  const dir = path.dirname(basePath);
  let candidate = basePath;
  let suffix = 2;
  while (await pathExists(candidate)) {
    candidate = path.join(dir, `${stem}-${suffix}${ext}`);
    suffix += 1;
  }
  return candidate;
}

async function readSizeBytes(targetPath: string): Promise<number | undefined> {
  try {
    return (await fs.stat(targetPath)).size;
  } catch {
    return undefined;
  }
}

export async function writeTextBrowserArtifact(params: {
  sessionId?: string;
  kind: SessionArtifact["kind"];
  filename: string;
  contents: string;
  label?: string;
  mimeType?: string;
  sourceUrl?: string;
  logger?: BrowserLogger;
}): Promise<SessionArtifact | null> {
  const text = params.contents.trim();
  if (!params.sessionId || text.length === 0) {
    return null;
  }
  const dir = resolveSessionArtifactsDir(params.sessionId);
  await fs.mkdir(dir, { recursive: true });
  const filename = sanitizePathSegment(params.filename, "artifact.md");
  const targetPath = await resolveUniquePath(path.join(dir, filename));
  await fs.writeFile(targetPath, `${text}\n`, "utf8");
  params.logger?.(`[browser] Saved ${params.kind} artifact to ${targetPath}`);
  return {
    kind: params.kind,
    path: targetPath,
    label: params.label,
    mimeType: params.mimeType ?? "text/markdown",
    sizeBytes: await readSizeBytes(targetPath),
    sourceUrl: params.sourceUrl,
  };
}

function isToolOnlyPlaceholder(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    normalized === "called tool" ||
    normalized === "used tool" ||
    normalized === "użyto narzędzia" ||
    normalized === "narzędzie wywołane"
  );
}

export async function saveDeepResearchReportArtifact(params: {
  sessionId?: string;
  reportMarkdown: string;
  conversationUrl?: string;
  logger?: BrowserLogger;
}): Promise<SessionArtifact | null> {
  const report = params.reportMarkdown.trim();
  if (report.length < 40 || isToolOnlyPlaceholder(report)) {
    return null;
  }
  return writeTextBrowserArtifact({
    sessionId: params.sessionId,
    kind: "deep-research-report",
    filename: "deep-research-report.md",
    contents: report,
    label: "Deep Research report",
    mimeType: "text/markdown",
    sourceUrl: params.conversationUrl,
    logger: params.logger,
  });
}

export interface DeepResearchMetadata {
  title: string | null;
  completedIn: string | null;
  citationsCount: number | null;
  searchesCount: number | null;
  referencesText: string | null;
}

function parseDeepResearchCount(rawText: string, label: "citations" | "searches"): number | null {
  for (const line of rawText.split(/\n+/)) {
    const direct = line.trim().match(new RegExp(`^(\\d+)\\s+${label}\\b`, "i"));
    if (direct?.[1]) {
      return Number.parseInt(direct[1], 10);
    }
  }
  return null;
}

function extractDeepResearchTitle(lines: string[]): string | null {
  const ignored =
    /^(research completed|copy contents|export to markdown|export to word|export to pdf)/i;
  for (const line of lines) {
    if (/^\d+$/.test(line) || ignored.test(line)) {
      continue;
    }
    if (/citations?|searches?/i.test(line)) {
      continue;
    }
    return line;
  }
  return null;
}

export function extractDeepResearchMetadata(reportMarkdown: string): DeepResearchMetadata {
  const text = reportMarkdown.trim();
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const completedIn =
    text.match(/Research completed in\s+([^·\n]+)/i)?.[1]?.trim() ??
    text.match(/Research completed in\s+(.+?)\s+citations/i)?.[1]?.trim() ??
    null;
  const referencesIndex = lines.findIndex((line) => /^references$/i.test(line));
  const referencesText =
    referencesIndex >= 0 ? lines.slice(referencesIndex).join("\n").trim() || null : null;
  return {
    title: extractDeepResearchTitle(lines),
    completedIn,
    citationsCount: parseDeepResearchCount(text, "citations"),
    searchesCount: parseDeepResearchCount(text, "searches"),
    referencesText,
  };
}

export async function saveDeepResearchMetadataArtifact(params: {
  sessionId?: string;
  reportMarkdown: string;
  conversationUrl?: string;
  logger?: BrowserLogger;
}): Promise<SessionArtifact | null> {
  const report = params.reportMarkdown.trim();
  if (report.length < 40 || isToolOnlyPlaceholder(report)) {
    return null;
  }
  const metadata = extractDeepResearchMetadata(report);
  return writeTextBrowserArtifact({
    sessionId: params.sessionId,
    kind: "deep-research-metadata",
    filename: "deep-research-metadata.json",
    contents: JSON.stringify(metadata, null, 2),
    label: "Deep Research metadata",
    mimeType: "application/json",
    sourceUrl: params.conversationUrl,
    logger: params.logger,
  });
}

export async function saveBrowserTranscriptArtifact(params: {
  sessionId?: string;
  prompt: string;
  answerMarkdown: string;
  conversationUrl?: string;
  artifacts?: SessionArtifact[];
  logger?: BrowserLogger;
}): Promise<SessionArtifact | null> {
  const answer = params.answerMarkdown.trim();
  if (!answer) {
    return null;
  }
  const artifactLines =
    params.artifacts && params.artifacts.length > 0
      ? [
          "",
          "## Artifacts",
          "",
          ...params.artifacts.map((artifact) => {
            const label = artifact.label ?? artifact.kind;
            return `- ${label}: ${artifact.path}`;
          }),
        ]
      : [];
  const conversationLines = params.conversationUrl
    ? ["", `Conversation: ${params.conversationUrl}`, ""]
    : ["", ""];
  const body = [
    "# Oracle Browser Transcript",
    ...conversationLines,
    "## Prompt",
    "",
    params.prompt.trim(),
    "",
    "## Answer",
    "",
    answer,
    ...artifactLines,
  ].join("\n");
  return writeTextBrowserArtifact({
    sessionId: params.sessionId,
    kind: "transcript",
    filename: "transcript.md",
    contents: body,
    label: "Browser transcript",
    mimeType: "text/markdown",
    sourceUrl: params.conversationUrl,
    logger: params.logger,
  });
}

export function appendArtifacts(
  existing: SessionArtifact[] | undefined,
  additions: Array<SessionArtifact | null | undefined>,
): SessionArtifact[] | undefined {
  const merged = new Map<string, SessionArtifact>();
  for (const artifact of existing ?? []) {
    merged.set(`${artifact.kind}:${artifact.path}`, artifact);
  }
  for (const artifact of additions) {
    if (artifact) {
      merged.set(`${artifact.kind}:${artifact.path}`, artifact);
    }
  }
  const values = Array.from(merged.values());
  return values.length > 0 ? values : undefined;
}

export const __test__ = {
  normalizeSessionId,
  sanitizePathSegment,
};
