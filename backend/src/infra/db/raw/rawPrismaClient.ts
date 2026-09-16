import { PrismaClient } from '../../../../prisma/generated/raw-client'

export function createRawPrismaClient(): PrismaClient {
  return new PrismaClient()
}
