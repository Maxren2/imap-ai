// Imported by relative path rather than the "@prisma/client" package name:
// that package's exports map resolves "types" to a generic untyped stub
// under every condition (a known Prisma/bundler-resolution quirk), which
// silently degrades every Prisma call to `any`. A relative import bypasses
// package exports resolution entirely and gets the real generated types.
import { PrismaClient } from "./generated/prisma/index.js";

export const prisma = new PrismaClient();
