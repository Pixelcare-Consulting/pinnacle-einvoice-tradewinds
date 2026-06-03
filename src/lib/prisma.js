require("dotenv").config();
const { PrismaClient } = require("../generated/prisma");

function parsePrismaLogLevels() {
  const raw = (process.env.PRISMA_LOG || "").trim();
  if (!raw) {
    return ["error"];
  }
  const levels = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => ["query", "info", "warn", "error"].includes(s));
  return levels.length > 0 ? levels : ["error"];
}

function createPrismaClient() {
  return new PrismaClient({
    log: parsePrismaLogLevels(),
  });
}

const prisma = createPrismaClient();

module.exports = prisma;
module.exports.createPrismaClient = createPrismaClient;
module.exports.parsePrismaLogLevels = parsePrismaLogLevels;
