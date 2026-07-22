import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { searchSources, getSourceById } from "./sources.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIDGET_HTML = readFileSync(
  path.join(__dirname, "widgets", "report.html"),
  "utf8"
);
const WIDGET_URI = "ui://widget/report.html";

// In-memory draft store. Fine for a personal prototype; swap for a real
// datastore (keyed by user + report id) before this touches real users.
let currentReport = null;

function resolveCitations(citations = []) {
  return citations
    .map((c) => {
      const src = getSourceById(c.sourceId);
      if (!src) return null;
      return {
        marker: c.marker,
        sourceId: src.id,
        title: src.title,
        sourceType: src.sourceType,
        ref: src.ref,
        snippet: src.snippet,
      };
    })
    .filter(Boolean);
}

function touch(report) {
  report.updatedAt = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
  report.version = (report.version || 1);
  return report;
}

function widgetResult(report, summaryText) {
  return {
    content: [{ type: "text", text: summaryText }],
    structuredContent: report,
    _meta: { "openai/outputTemplate": WIDGET_URI },
  };
}

function buildServer() {
  const server = new McpServer(
    { name: "authoring", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  // --- Widget resource -----------------------------------------------
  server.registerResource(
    "report-widget",
    WIDGET_URI,
    { mimeType: "text/html+skybridge", title: "Authoring report draft" },
    async () => ({
      contents: [
        { uri: WIDGET_URI, mimeType: "text/html+skybridge", text: WIDGET_HTML },
      ],
    })
  );

  // --- Tool: search_sources -------------------------------------------
  server.registerTool(
    "search_sources",
    {
      title: "Search sources",
      description:
        "Use this when the analyst wants to find supporting material for a report section. " +
        "Searches internal document repository, market data snapshots, and web results. " +
        "Returns short excerpts with a sourceId you must reference when drafting citations.",
      inputSchema: {
        query: z.string().describe("Topic or keyword to search for"),
        sourceTypes: z
          .array(z.enum(["internal_repo", "market_data", "web"]))
          .optional()
          .describe("Restrict to these source types; omit to search all"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, sourceTypes }) => {
      const results = searchSources({ query, sourceTypes: sourceTypes || [] });
      const summary = results
        .map((r) => `[${r.sourceType}] ${r.title} (id: ${r.id}) — ${r.snippet}`)
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: results.length
              ? `Found ${results.length} source(s):\n${summary}`
              : "No matching sources found.",
          },
        ],
        structuredContent: { results },
      };
    }
  );

  // --- Tool: render_report ---------------------------------------------
  server.registerTool(
    "render_report",
    {
      title: "Render report draft",
      description:
        "Use this once you have drafted one or more report sections using excerpts from search_sources. " +
        "Pass each section's body text with inline [1], [2]... markers, and a citations array mapping each " +
        "marker to the sourceId it came from. This displays the draft to the analyst as an editable widget.",
      inputSchema: {
        title: z.string().describe("Report title, e.g. company + note type"),
        sections: z
          .array(
            z.object({
              heading: z.string(),
              body: z
                .string()
                .describe("Section text with inline [1], [2] citation markers"),
              citations: z
                .array(
                  z.object({
                    marker: z.union([z.string(), z.number()]),
                    sourceId: z.string(),
                  })
                )
                .default([]),
            })
          )
          .min(1),
      },
    },
    async ({ title, sections }) => {
      currentReport = touch({
        title,
        version: 1,
        sections: sections.map((s) => ({
          heading: s.heading,
          body: s.body,
          citations: resolveCitations(s.citations),
        })),
      });
      return widgetResult(
        currentReport,
        `Drafted "${title}" with ${sections.length} section(s). Rendered to the analyst for review.`
      );
    }
  );

  // --- Tool: update_section ---------------------------------------------
  server.registerTool(
    "update_section",
    {
      title: "Update a report section",
      description:
        "Use this to replace one section's text and/or citations after a manual edit or an AI refine " +
        "request. sectionIndex is 0-based, matching the currently rendered draft.",
      inputSchema: {
        sectionIndex: z.number().int().min(0),
        heading: z.string().optional(),
        body: z.string().optional(),
        citations: z
          .array(
            z.object({
              marker: z.union([z.string(), z.number()]),
              sourceId: z.string(),
            })
          )
          .optional(),
      },
    },
    async ({ sectionIndex, heading, body, citations }) => {
      if (!currentReport || !currentReport.sections[sectionIndex]) {
        return {
          content: [
            { type: "text", text: "No draft to update yet — call render_report first." },
          ],
          isError: true,
        };
      }
      const section = currentReport.sections[sectionIndex];
      if (heading !== undefined) section.heading = heading;
      if (body !== undefined) section.body = body;
      if (citations !== undefined) section.citations = resolveCitations(citations);
      currentReport.version = (currentReport.version || 1) + 1;
      touch(currentReport);
      return widgetResult(
        currentReport,
        `Updated section ${sectionIndex + 1} ("${section.heading}").`
      );
    }
  );

  // --- Tool: export_report ------------------------------------------
  server.registerTool(
    "export_report",
    {
      title: "Export the current draft",
      description:
        "Use when the analyst asks to export, download, or finalize the current draft. " +
        "Returns the full report as Markdown, including a numbered source list.",
      inputSchema: {},
    },
    async () => {
      if (!currentReport) {
        return {
          content: [{ type: "text", text: "There's no draft to export yet." }],
          isError: true,
        };
      }
      const lines = [`# ${currentReport.title}`, ""];
      const allCitations = [];
      currentReport.sections.forEach((s) => {
        lines.push(`## ${s.heading}`, "", s.body, "");
        s.citations.forEach((c) => allCitations.push(c));
      });
      lines.push("---", "", "### Sources");
      allCitations.forEach((c) => {
        lines.push(`[${c.marker}] ${c.title} — ${c.ref}`);
      });
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: { markdown: lines.join("\n") },
      };
    }
  );

  return server;
}

// --- HTTP wiring (stateless: one MCP session per request) -------------
const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Authoring MCP server listening on http://localhost:${PORT}/mcp`);
});
