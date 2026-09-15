export type Role = 'ADMIN' | 'OPERATOR' | 'VIEWER'

export interface User {
  id: string
  email: string
  passwordHash: string
  role: Role
  createdAt: Date
}
