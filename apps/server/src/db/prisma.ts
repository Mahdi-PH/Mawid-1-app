import { PrismaClient } from "@prisma/client";

// Single shared instance (tsx watch / serverless-style reloads would otherwise
// exhaust the Postgres connection pool by creating a new client per reload).
export const prisma = new PrismaClient();
