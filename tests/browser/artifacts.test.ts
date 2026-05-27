import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  appendArtifacts,
  extractDeepResearchMetadata,
  resolveSessionArtifactsDir,
  saveBrowserTranscriptArtifact,
  saveDeepResearchMetadataArtifact,
  saveDeepResearchReportArtifact,
  __test__,
} from "../../src/browser/artifacts.js";
import { setOracleHomeDirOverrideForTest } from "../../src/oracleHome.js";

describe("browser session artifacts", () => {
  afterEach(() => {
    setOracleHomeDirOverrideForTest(null);
  });

  test("writes Deep Research reports into the session artifacts directory", async () => {
    const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-artifacts-"));
    setOracleHomeDirOverrideForTest(tmpHome);

    const artifact = await saveDeepResearchReportArtifact({
      sessionId: "steam-export-audit",
      reportMarkdown:
        "CHECK_DEEP_OK This completed report includes enough content to be saved.\nhttps://example.com/source",
      conversationUrl: "https://chatgpt.com/c/abc",
    });

    expect(artifact).toMatchObject({
      kind: "deep-research-report",
      label: "Deep Research report",
      mimeType: "text/markdown",
      sourceUrl: "https://chatgpt.com/c/abc",
    });
    expect(artifact?.path).toBe(
      path.join(tmpHome, "sessions", "steam-export-audit", "artifacts", "deep-research-report.md"),
    );
    await expect(fs.readFile(artifact!.path, "utf8")).resolves.toContain("CHECK_DEEP_OK");
  });

  test("does not save tool-call placeholders as Deep Research reports", async () => {
    const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-artifacts-"));
    setOracleHomeDirOverrideForTest(tmpHome);

    await expect(
      saveDeepResearchReportArtifact({
        sessionId: "tool-placeholder",
        reportMarkdown: "Called tool",
      }),
    ).resolves.toBeNull();
  });

  test("writes Deep Research metadata without guessing animated citation counters", async () => {
    const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-research-metadata-"));
    setOracleHomeDirOverrideForTest(tmpHome);
    const report = [
      "Research completed in 15m ·",
      "0",
      "1",
      "citations ·",
      "0",
      "1",
      "searches",
      "Scientific decision review for GitHub issue 145",
      "Executive assessment",
      "The supplied evidence supports a clear decision.",
      "References",
      "1. Example reference. https://example.com",
    ].join("\n");

    const metadata = extractDeepResearchMetadata(report);
    expect(metadata).toMatchObject({
      title: "Scientific decision review for GitHub issue 145",
      completedIn: "15m",
      citationsCount: null,
      searchesCount: null,
    });
    expect(metadata.referencesText).toContain("Example reference");

    const artifact = await saveDeepResearchMetadataArtifact({
      sessionId: "issue-145",
      reportMarkdown: report,
      conversationUrl: "https://chatgpt.com/c/abc",
    });

    expect(artifact).toMatchObject({
      kind: "deep-research-metadata",
      label: "Deep Research metadata",
      mimeType: "application/json",
      sourceUrl: "https://chatgpt.com/c/abc",
    });
    const saved = JSON.parse(await fs.readFile(artifact!.path, "utf8")) as {
      title?: string;
      referencesText?: string;
    };
    expect(saved.title).toBe("Scientific decision review for GitHub issue 145");
    expect(saved.referencesText).toContain("https://example.com");
  });

  test("writes a transcript with prompt, answer, conversation URL, and artifact references", async () => {
    const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-transcript-"));
    setOracleHomeDirOverrideForTest(tmpHome);

    const transcript = await saveBrowserTranscriptArtifact({
      sessionId: "browser-answer",
      prompt: "What changed?",
      answerMarkdown: "The patch now saves artifacts.",
      conversationUrl: "https://chatgpt.com/c/abc",
      artifacts: [
        {
          kind: "deep-research-report",
          path: "/tmp/report.md",
          label: "Deep Research report",
        },
      ],
    });

    expect(transcript?.path).toContain(resolveSessionArtifactsDir("browser-answer"));
    const saved = await fs.readFile(transcript!.path, "utf8");
    expect(saved).toContain("## Prompt");
    expect(saved).toContain("What changed?");
    expect(saved).toContain("## Answer");
    expect(saved).toContain("The patch now saves artifacts.");
    expect(saved).toContain("Conversation: https://chatgpt.com/c/abc");
    expect(saved).toContain("Deep Research report: /tmp/report.md");
  });

  test("dedupes artifact lists by kind and path", () => {
    const artifact = { kind: "transcript" as const, path: "/tmp/transcript.md" };
    expect(appendArtifacts([artifact], [artifact, null, undefined])).toEqual([artifact]);
  });

  test("sanitizes path segments used for session artifact paths", () => {
    expect(__test__.normalizeSessionId("../bad session")).toBe("bad-session");
  });
});
