const { parsePrismaLogLevels } = require('../src/lib/prisma');

describe('Prisma log level parsing', () => {
  const prev = process.env.PRISMA_LOG;

  afterEach(() => {
    if (prev === undefined) delete process.env.PRISMA_LOG;
    else process.env.PRISMA_LOG = prev;
  });

  test('defaults to errors only', () => {
    delete process.env.PRISMA_LOG;
    expect(parsePrismaLogLevels()).toEqual(['error']);
  });

  test('parses PRISMA_LOG query,warn', () => {
    process.env.PRISMA_LOG = 'query,warn';
    expect(parsePrismaLogLevels()).toEqual(['query', 'warn']);
  });

  test('falls back to error for invalid levels', () => {
    process.env.PRISMA_LOG = 'invalid';
    expect(parsePrismaLogLevels()).toEqual(['error']);
  });
});
