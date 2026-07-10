import { getPrismaClient, type PrismaClient } from "@nimbus/db";

export async function markDurableJobRunning(
  backgroundJobId: string,
  prisma: PrismaClient = getPrismaClient(),
) {
  return prisma.backgroundJob.update({
    where: { id: backgroundJobId },
    data: {
      status: "running",
      attempts: { increment: 1 },
      startedAt: new Date(),
      completedAt: null,
      failureCode: null,
      lastError: null,
    },
  });
}

export async function markDurableJobSucceeded(
  backgroundJobId: string,
  prisma: PrismaClient = getPrismaClient(),
) {
  await prisma.backgroundJob.update({
    where: { id: backgroundJobId },
    data: {
      status: "succeeded",
      failureCode: null,
      lastError: null,
      completedAt: new Date(),
    },
  });
}

export async function markDurableJobFailed(
  backgroundJobId: string,
  failureCode: string,
  prisma: PrismaClient = getPrismaClient(),
) {
  await prisma.backgroundJob.update({
    where: { id: backgroundJobId },
    data: {
      status: "failed",
      failureCode,
      lastError: failureCode,
      completedAt: new Date(),
    },
  });
}

export async function markDurableJobDeadLettered(
  backgroundJobId: string,
  failureCode: string,
  prisma: PrismaClient = getPrismaClient(),
) {
  await prisma.backgroundJob.update({
    where: { id: backgroundJobId },
    data: {
      status: "dead_lettered",
      failureCode,
      lastError: failureCode,
      completedAt: new Date(),
    },
  });
}
