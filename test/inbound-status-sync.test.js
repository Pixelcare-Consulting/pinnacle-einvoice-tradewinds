const {
  isNonTerminalInboundStatus,
  extractUniqueSubmissionUids,
} = require('../src/lib/inbound-sync-helpers');
const {
  parseInboundListParams,
  buildInboundListWhere,
  wantsInboundPagination,
  summarizeInboundStatusGroups,
  QUEUE_STATUSES,
} = require('../src/lib/inbound-list-helpers');

function buildStatusCheckChanges(beforeRows, afterRows) {
  const beforeByUuid = new Map(beforeRows.map((doc) => [doc.uuid, doc]));
  const changes = [];
  for (const after of afterRows) {
    const before = beforeByUuid.get(after.uuid);
    if (!before) continue;
    const statusChanged =
      (after.status || '').toLowerCase() !== (before.status || '').toLowerCase();
    const validatedChanged =
      (after.dateTimeValidated || null) !== (before.dateTimeValidated || null);
    if (statusChanged || validatedChanged) {
      changes.push({
        uuid: after.uuid,
        oldStatus: before.status,
        newStatus: after.status,
      });
    }
  }
  return changes;
}

function mockReq(query) {
  return { query };
}

describe('Inbound status-sync logic', () => {
  test('status-check targets non-terminal UUIDs only', () => {
    const monitorUuids = ['u1', 'u2', 'u3'];
    const dbRows = [
      { uuid: 'u1', status: 'Submitted', dateTimeValidated: null },
      { uuid: 'u2', status: 'Valid', dateTimeValidated: '2026-05-11' },
      { uuid: 'u3', status: 'Processing', dateTimeValidated: null },
    ];

    const toReconcile = dbRows.filter(
      (doc) =>
        monitorUuids.includes(doc.uuid) &&
        isNonTerminalInboundStatus(doc.status)
    );
    expect(toReconcile).toHaveLength(2);
    expect(toReconcile.map((d) => d.uuid).sort()).toEqual(['u1', 'u3']);
  });

  test('detects Submitted to Valid with validation date', () => {
    const changes = buildStatusCheckChanges(
      [{ uuid: 'u1', status: 'Submitted', dateTimeValidated: null }],
      [{ uuid: 'u1', status: 'Valid', dateTimeValidated: '2026-05-11T10:00:00' }]
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].oldStatus).toBe('Submitted');
    expect(changes[0].newStatus).toBe('Valid');
  });

  test('returns no changes when status and dates unchanged', () => {
    expect(
      buildStatusCheckChanges(
        [{ uuid: 'u1', status: 'Submitted', dateTimeValidated: null }],
        [{ uuid: 'u1', status: 'Submitted', dateTimeValidated: null }]
      )
    ).toEqual([]);
  });

  test('extractUniqueSubmissionUids accepts lowercase submissionuid', () => {
    expect(extractUniqueSubmissionUids([{ submissionuid: 'x' }])).toEqual(['x']);
  });
});

describe('Inbound list paging helpers', () => {
  test('parseInboundListParams defaults length to 10', () => {
    const params = parseInboundListParams(mockReq({ start: '0' }));
    expect(params.start).toBe(0);
    expect(params.length).toBe(10);
    expect(params.statusFilter).toBe('all');
    expect(params.orderBy).toEqual({ dateTimeReceived: 'desc' });
  });

  test('buildInboundListWhere maps queue filter to in-list statuses', () => {
    const where = buildInboundListWhere(
      parseInboundListParams(mockReq({ statusFilter: 'queue' }))
    );
    expect(where.AND).toEqual([{ status: { in: QUEUE_STATUSES } }]);
  });

  test('buildInboundListWhere adds OR search across key fields', () => {
    const where = buildInboundListWhere(
      parseInboundListParams(mockReq({ 'search[value]': 'ACME' }))
    );
    expect(where.AND[0].OR).toHaveLength(5);
  });

  test('wantsInboundPagination when start or length present', () => {
    expect(wantsInboundPagination(mockReq({ start: '0' }))).toBe(true);
    expect(wantsInboundPagination(mockReq({ length: '25' }))).toBe(true);
    expect(wantsInboundPagination(mockReq({}))).toBe(false);
  });

  test('summarizeInboundStatusGroups aggregates queue separately', () => {
    const summary = summarizeInboundStatusGroups([
      { status: 'Valid', _count: { status: 10 } },
      { status: 'Submitted', _count: { status: 3 } },
      { status: 'Processing', _count: { status: 2 } },
    ]);
    expect(summary.invoices).toBe(15);
    expect(summary.valid).toBe(10);
    expect(summary.queue).toBe(5);
  });
});
