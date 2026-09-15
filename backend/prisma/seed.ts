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
const ROOMS = [
  { name: 'Salle 203', device: { id: 'sensor-001', name: 'Capteur salle 203' } },
  { name: 'Salle 204', device: { id: 'sensor-002', name: 'Capteur salle 204' } },
  { name: 'Salle 205', device: { id: 'sensor-003', name: 'Capteur salle 205' } }
]

const DEMO_USER = {
  email: 'demo@campify.local',
  password: 'campify-demo',
  role: 'VIEWER' as const
}

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

    const passwordHash = await bcrypt.hash(DEMO_USER.password, 10)
    await prisma.user.upsert({
      where: { email: DEMO_USER.email },
      update: {},
      create: { email: DEMO_USER.email, passwordHash, role: DEMO_USER.role }
    })

    console.log(`Seed OK — ${ROOMS.length} salles/devices, utilisateur démo ${DEMO_USER.email} / ${DEMO_USER.password}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
