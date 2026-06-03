const {
  parseInboundListParams,
  buildInboundListWhere,
  wantsInboundPagination,
  summarizeInboundStatusGroups,
} = require("../src/lib/inbound-list-helpers");

function mockReq(query) {
  return { query };
}

describe("inbound-list-helpers", () => {
  test("wantsInboundPagination when start/length or useDatabase", () => {
    expect(wantsInboundPagination(mockReq({ start: 0 }))).toBe(true);
    expect(wantsInboundPagination(mockReq({ useDatabase: "true" }))).toBe(true);
    expect(wantsInboundPagination(mockReq({}))).toBe(false);
  });

  test("parseInboundListParams defaults length to 10", () => {
    const p = parseInboundListParams(mockReq({ useDatabase: "true" }));
    expect(p.length).toBe(10);
    expect(p.start).toBe(0);
    expect(p.orderBy).toEqual({ dateTimeReceived: "desc" });
  });

  test("buildInboundListWhere maps queue filter", () => {
    const where = buildInboundListWhere(
      parseInboundListParams(mockReq({ statusFilter: "queue" }))
    );
    expect(where.AND).toBeDefined();
    expect(where.AND.some((c) => c.status?.in)).toBe(true);
  });

  test("summarizeInboundStatusGroups aggregates counts", () => {
    const summary = summarizeInboundStatusGroups([
      { status: "Valid", _count: { status: 10 } },
      { status: "Submitted", _count: { status: 3 } },
    ]);
    expect(summary.invoices).toBe(13);
    expect(summary.valid).toBe(10);
    expect(summary.queue).toBe(3);
  });
});
