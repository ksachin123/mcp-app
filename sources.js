// sources.js
// Stand-in "connectors" for prototyping. Each returns documents shaped the
// same way regardless of origin, so the report/citation logic never needs
// to know or care which real system (SharePoint, FactSet, web) they came from.
// Swap the body of each function for a real MCP client call when you're
// ready to point at live systems.

const INTERNAL_REPO = [
  {
    id: "int-001",
    sourceType: "internal_repo",
    title: "Q2 Channel Checks — APAC Hardware Distributors",
    ref: "AuthoringDrive/ChannelChecks/2026-Q2-APAC-Hardware.pdf, p.4",
    snippet:
      "Distributor sell-through in APAC rose 9% q/q in June, ahead of the 5-6% typically seen entering a seasonally soft quarter. Two of three distributors cited restocking ahead of an expected price increase.",
  },
  {
    id: "int-002",
    sourceType: "internal_repo",
    title: "Analyst Model — Working Notes",
    ref: "AuthoringDrive/Models/CoverageCo_v14.xlsx, Assumptions tab",
    snippet:
      "Gross margin assumption raised 40bps for FY27 on mix shift toward the premium SKU line, consistent with management's commentary on the Q1 call.",
  },
];

const MARKET_DATA = [
  {
    id: "mkt-001",
    sourceType: "market_data",
    title: "Consensus EPS Revisions (30-day)",
    ref: "Vendor snapshot 2026-07-20T14:00Z",
    snippet:
      "FY27 consensus EPS has moved up 2.1% over the trailing 30 days, with 11 of 14 covering analysts revising estimates higher following the June channel data.",
  },
  {
    id: "mkt-002",
    sourceType: "market_data",
    title: "Implied Volatility Surface",
    ref: "Vendor snapshot 2026-07-21T09:30Z",
    snippet:
      "30-day implied volatility sits at the 22nd percentile of the trailing 12-month range, suggesting the options market is not currently pricing material event risk into the print.",
  },
];

const WEB = [
  {
    id: "web-001",
    sourceType: "web",
    title: "Company press release — capacity expansion",
    ref: "https://example.com/ir/2026-07-15-capacity",
    snippet:
      "The company announced a $180M expansion of its Vietnam facility, targeted for completion in Q1 FY28, expected to add ~15% unit capacity.",
  },
];

const ALL = [...INTERNAL_REPO, ...MARKET_DATA, ...WEB];

/**
 * Very small keyword search over the fake corpus. Replace with a real
 * retrieval call (vector store, vendor API, web search tool) per source type.
 */
function searchSources({ query = "", sourceTypes = [] } = {}) {
  const q = query.toLowerCase();
  const pool = sourceTypes.length
    ? ALL.filter((d) => sourceTypes.includes(d.sourceType))
    : ALL;

  if (!q) return pool;

  const scored = pool.filter(
    (d) =>
      d.title.toLowerCase().includes(q) ||
      d.snippet.toLowerCase().includes(q)
  );

  // Fall back to returning the pool for this source type so the prototype
  // always has something to cite even with a loose query.
  return scored.length ? scored : pool;
}

function getSourceById(id) {
  return ALL.find((d) => d.id === id) || null;
}

export { searchSources, getSourceById, ALL };
