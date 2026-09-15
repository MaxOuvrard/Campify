import { PrismaClient } from '@prisma/client'
import { UserRepository } from '../../domain/ports/UserRepository'
import { User, Role } from '../../domain/entities/User'

interface UserRow {
  id: string
  email: string
  passwordHash: string
  role: string
  createdAt: Date
}

function toDomain(row: UserRow): User {
  return { id: row.id, email: row.email, passwordHash: row.passwordHash, role: row.role as Role, createdAt: row.createdAt }
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { email } })
    return row ? toDomain(row) : null
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id } })
    return row ? toDomain(row) : null
  }
}
