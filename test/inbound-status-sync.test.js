const {
  isNonTerminalInboundStatus,
  extractUniqueSubmissionUids,
} = require('../src/lib/inbound-sync-helpers');

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
