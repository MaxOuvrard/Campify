/**
 * Simulateur de devices MQTT pour tester en local les scénarios J3 sans
 * dépendre du broker partagé du kit (VPS) : plusieurs capteurs en
 * parallèle avec un id stable, doublons, coupure brutale, montée en
 * charge, message retained, comparaison QoS 0/1.
 *
 * Chaque device se connecte avec son propre identifiant MQTT (= son
 * deviceId) — l'ACL du broker local (backend/mosquitto.acl, voir ADR
 * 0008) exige donc d'avoir généré un mot de passe pour chacun au préalable
 * (backend/README.md, section Démarrage).
 *
 * Usage : voir `npm run simulate:devices -- --help`.
 */
import mqtt, { MqttClient } from 'mqtt'
import { parseArgs } from 'node:util'
import { randomUUID } from 'node:crypto'

interface DeviceSpec {
  id: string
  roomId: string
}

interface SimulatorOptions {
  broker: string
  devices: DeviceSpec[]
  password: string
  topicPrefix: string
  intervalMs: number
  qos: 0 | 1
  retain: boolean
  duplicateRate: number
}

const HELP = `Simulateur de devices MQTT (Campify, J3)

Options :
  --broker <url>           Défaut : mqtt://localhost:1883 (ou $MQTT_URL)
  --devices <liste>        Ids séparés par des virgules. Défaut : sensor-001,sensor-002,sensor-003
  --rooms <liste>          Room ids associés, même ordre que --devices. Défaut : salle-203,salle-204,salle-205
  --password <mdp>         Mot de passe MQTT partagé par tous les devices simulés (username = deviceId)
  --topic-prefix <prefix>  Défaut : campus
  --interval <ms>          Défaut : 2000 (cadence observée du kit)
  --qos <0|1>               Défaut : 0
  --retain                  Publie chaque message avec le flag retained
  --duplicate-rate <0..1>   Probabilité de republier le même message_id juste après (retransmission simulée). Défaut : 0
  --help                    Affiche cette aide

Exemples :
  npm run simulate:devices -- --password changeme-local-only
  npm run simulate:devices -- --password changeme-local-only --devices sensor-001 --qos 1 --duplicate-rate 0.2
  npm run simulate:devices -- --password changeme-local-only --devices sensor-001 --retain --interval 5000
`

function parseOptions(argv: string[]): SimulatorOptions | null {
  const { values } = parseArgs({
    args: argv,
    options: {
      broker: { type: 'string', default: process.env.MQTT_URL ?? 'mqtt://localhost:1883' },
      devices: { type: 'string', default: 'sensor-001,sensor-002,sensor-003' },
      rooms: { type: 'string', default: 'salle-203,salle-204,salle-205' },
      password: { type: 'string', default: '' },
      'topic-prefix': { type: 'string', default: 'campus' },
      interval: { type: 'string', default: '2000' },
      qos: { type: 'string', default: '0' },
      retain: { type: 'boolean', default: false },
      'duplicate-rate': { type: 'string', default: '0' },
      help: { type: 'boolean', default: false }
    }
  })

  if (values.help) {
    console.log(HELP)
    return null
  }

  const ids = values.devices!.split(',').map((s) => s.trim()).filter(Boolean)
  const roomIds = values.rooms!.split(',').map((s) => s.trim()).filter(Boolean)
  const devices: DeviceSpec[] = ids.map((id, i) => ({ id, roomId: roomIds[i] ?? `room-${i + 1}` }))

  const qos = Number(values.qos)
  if (qos !== 0 && qos !== 1) {
    throw new Error(`--qos doit valoir 0 ou 1 (reçu: ${values.qos})`)
  }

  return {
    broker: values.broker!,
    devices,
    password: values.password!,
    topicPrefix: values['topic-prefix']!,
    intervalMs: Number(values.interval),
    qos,
    retain: Boolean(values.retain),
    duplicateRate: Number(values['duplicate-rate'])
  }
}

/** Marche aléatoire bornée — plus réaliste qu'un tirage uniforme indépendant à chaque tick. */
function nextValue(previous: number, min: number, max: number, maxStep: number): number {
  const next = previous + (Math.random() * 2 - 1) * maxStep
  return Math.min(max, Math.max(min, next))
}

function buildPayload(device: DeviceSpec, bootId: string, counter: number, temperature: number, co2: number) {
  return {
    schema_version: 1,
    message_id: `${bootId}-${counter}`,
    device_id: device.id,
    room_id: device.roomId,
    observed_at: new Date().toISOString(),
    temperature: { value: Math.round(temperature * 100) / 100, unit: '°C' },
    co2: { value: Math.round(co2), unit: 'ppm' }
  }
}

function runDevice(client: MqttClient, device: DeviceSpec, opts: SimulatorOptions): () => void {
  const bootId = randomUUID().replace(/-/g, '')
  let counter = 0
  let temperature = 20 + Math.random() * 3
  let co2 = 500 + Math.random() * 300
  const topic = `${opts.topicPrefix}/v1/devices/${device.id}/telemetry`

  const publishOnce = () => {
    counter += 1
    temperature = nextValue(temperature, 15, 30, 0.4)
    co2 = nextValue(co2, 400, 2500, 40)
    const payload = JSON.stringify(buildPayload(device, bootId, counter, temperature, co2))

    client.publish(topic, payload, { qos: opts.qos, retain: opts.retain }, (err) => {
      if (err) {
        console.error(`[${device.id}] échec de publication: ${err.message}`)
        return
      }
      console.log(`[${device.id}] → temperature=${temperature.toFixed(2)}°C co2=${Math.round(co2)}ppm message_id=${bootId}-${counter}`)
    })

    if (Math.random() < opts.duplicateRate) {
      setTimeout(() => {
        // Même message_id, même payload : simule une retransmission MQTT
        // exacte (QoS ≥ 1) — c'est précisément ce que la dédup doit rejeter.
        client.publish(topic, payload, { qos: opts.qos, retain: opts.retain }, (err) => {
          if (err) return
          console.log(`[${device.id}] → (doublon simulé) message_id=${bootId}-${counter}`)
        })
      }, 50)
    }
  }

  publishOnce()
  const interval = setInterval(publishOnce, opts.intervalMs)
  return () => clearInterval(interval)
}

function main(): void {
  const opts = parseOptions(process.argv.slice(2))
  if (opts === null) return // --help déjà affiché

  if (!opts.password) {
    console.error('--password est requis (voir backend/README.md pour générer les identifiants mosquitto)')
    process.exitCode = 1
    return
  }

  console.log(`Simulation de ${opts.devices.length} device(s) sur ${opts.broker} (QoS ${opts.qos}, intervalle ${opts.intervalMs}ms, retain=${opts.retain})`)

  const stopFns: Array<() => void> = []
  const clients: MqttClient[] = []

  for (const device of opts.devices) {
    const client = mqtt.connect(opts.broker, { username: device.id, password: opts.password })
    clients.push(client)

    client.on('connect', () => {
      console.log(`[${device.id}] connecté`)
      stopFns.push(runDevice(client, device, opts))
    })

    client.on('error', (err) => {
      console.error(`[${device.id}] erreur mqtt: ${err.message}`)
    })
  }

  const shutdown = () => {
    console.log('\nArrêt du simulateur…')
    for (const stop of stopFns) stop()
    for (const client of clients) client.end()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
