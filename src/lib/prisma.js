require("dotenv").config();
const { PrismaClient } = require("../generated/prisma");

function createPrismaClient() {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

const prisma = createPrismaClient();

module.exports = prisma;
module.exports.createPrismaClient = createPrismaClient;
