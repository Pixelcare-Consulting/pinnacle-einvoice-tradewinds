const {
  getSubmissionUidFromDoc,
  extractUniqueSubmissionUids,
  isNonTerminalInboundStatus,
} = require('../src/lib/inbound-sync-helpers');

describe('Inbound submission UID helpers', () => {
  test('getSubmissionUidFromDoc prefers camelCase', () => {
    expect(getSubmissionUidFromDoc({ submissionUid: 'uid-camel' })).toBe('uid-camel');
    expect(getSubmissionUidFromDoc({ submissionuid: 'uid-lower' })).toBe('uid-lower');
    expect(
      getSubmissionUidFromDoc({ submissionUid: 'a', submissionuid: 'b' })
    ).toBe('a');
    expect(getSubmissionUidFromDoc({})).toBeNull();
  });

  test('extractUniqueSubmissionUids deduplicates mixed casings', () => {
    expect(
      extractUniqueSubmissionUids([
        { submissionUid: 'a' },
        { submissionuid: 'b' },
        { submissionUid: 'a' },
        {},
      ])
    ).toEqual(['a', 'b']);
  });

  test('isNonTerminalInboundStatus', () => {
    expect(isNonTerminalInboundStatus('Submitted')).toBe(true);
    expect(isNonTerminalInboundStatus('Processing')).toBe(true);
    expect(isNonTerminalInboundStatus('Valid')).toBe(false);
  });
});
