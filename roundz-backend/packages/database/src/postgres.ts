import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | undefined;

export function createPostgresClient() {
  if (!prisma) {
    prisma = new PrismaClient({
      log: ['error', 'warn'],
    });
  }

  return prisma;
}

export async function connectPostgres() {
  const client = createPostgresClient();
  await client.$connect();
  return client;
}

export async function disconnectPostgres() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}
