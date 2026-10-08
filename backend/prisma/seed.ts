import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

/**
 * Données de démo alignées sur le broker MQTT de démonstration observé
 * (campus/v1/devices/{sensor-001,sensor-002,sensor-003}/telemetry) — voir
 * docs/decisions/0004-contrat-mqtt-placeholder.md. Les ids de device sont
 * fixés pour correspondre exactement à ceux publiés par le simulateur :
 * MeasurementIngestionService ne crée pas de device à la volée, il faut
 * donc que la ligne existe déjà en base pour que l'ingestion réussisse.
 */
// Le nom du device ne doit jamais encoder sa salle d'origine : un capteur
// peut être réassigné à une autre salle par scan QR (voir
// docs/decisions/0007-association-qr-et-reaffectation.md), un nom du type
// "Capteur salle 203" deviendrait alors trompeur.
const ROOMS = [
  { name: 'Salle 203', device: { id: 'sensor-001', name: 'Capteur sensor-001' } },
  { name: 'Salle 204', device: { id: 'sensor-002', name: 'Capteur sensor-002' } },
  { name: 'Salle 205', device: { id: 'sensor-003', name: 'Capteur sensor-003' } }
]

// Deux comptes de démo : VIEWER (consultation seule) et OPERATOR (peut
// envoyer des commandes aux objets, J4 — RBAC de POST /devices/:id/commands).
const DEMO_USERS = [
  { email: 'demo@campify.local', password: 'campify-demo', role: 'VIEWER' as const },
  { email: 'operateur@campify.local', password: 'campify-operateur', role: 'OPERATOR' as const }
]

async function main(): Promise<void> {
  const prisma = new PrismaClient()

  try {
    for (const { name, device } of ROOMS) {
      const room = await prisma.room.upsert({
        where: { name },
        update: {},
        create: { name }
      })

      await prisma.device.upsert({
        where: { id: device.id },
        update: { name: device.name, roomId: room.id },
        create: { id: device.id, name: device.name, type: 'environmental', roomId: room.id }
      })
    }

    for (const user of DEMO_USERS) {
      const passwordHash = await bcrypt.hash(user.password, 10)
      await prisma.user.upsert({
        where: { email: user.email },
        update: {},
        create: { email: user.email, passwordHash, role: user.role }
      })
    }

    const accounts = DEMO_USERS.map((u) => `${u.email} / ${u.password} (${u.role})`).join(', ')
    console.log(`Seed OK — ${ROOMS.length} salles/devices, comptes démo : ${accounts}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
