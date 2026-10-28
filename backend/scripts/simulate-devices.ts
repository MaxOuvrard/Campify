/**
 * Simulateur de devices MQTT pour tester en local sans dépendre du broker
 * partagé du kit (VPS).
 *
 * - Télémétrie (J3) : plusieurs capteurs en parallèle avec un id stable,
 *   doublons, coupure brutale, montée en charge, message retained,
 *   comparaison QoS 0/1.
 * - Commandes (J4, ADR 0014) : chaque device s'abonne à SES commandes,
 *   les exécute (état ventilation/consigne) et renvoie un ACK portant le
 *   même command_id. Des options provoquent les anomalies J4 (objet
 *   silencieux, ACK perdu ou tardif, commande reçue deux fois, refus…).
 *   Logique côté objet : scripts/device/commandHandler.ts.
 *
 * Chaque device se connecte avec son propre identifiant MQTT (= son
 * deviceId) — l'ACL du broker local (backend/mosquitto.acl, voir ADR
 * 0008) exige donc d'avoir généré un mot de passe pour chacun au préalable
 * (backend/README.md, section Démarrage).
 *
 * Logs : une ligne JSON par événement (scripts/device/log.ts), au format du
 * backend, pour être collectés par Promtail quand le simulateur tourne en
 * conteneur (`docker compose run --rm simulator …`).
 *
 * Usage : voir `npm run simulate:devices -- --help`.
 */
import mqtt, { MqttClient } from 'mqtt'
import { parseArgs } from 'node:util'
import { randomUUID } from 'node:crypto'
import { CommandMode, DeviceCommandHandler, DeviceState, HandleResult } from './device/commandHandler'
import { co2At, Co2Profile } from './device/co2Scenario'
import { log } from './device/log'

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
  commandMode: CommandMode
  dropAck: boolean
  ackDelayMs: number
  redeliver: boolean
  persistentSession: boolean
  /** Mode scénario J5 (co2Scenario.ts) : ces devices font le pic, les autres restent calmes. null = marche aléatoire. */
  co2Spike: string[] | null
}

const HELP = `Simulateur de devices MQTT (Campify, J3/J4)

Télémétrie :
  --broker <url>           Défaut : $MQTT_URL ou mqtt://localhost:1883
  --devices <liste>        Ids séparés par des virgules. Défaut : sensor-001,sensor-002,sensor-003
  --rooms <liste>          Room ids associés, même ordre que --devices. Défaut : salle-203,salle-204,salle-205
  --password <mdp>         Mot de passe MQTT partagé par tous les devices simulés (username = deviceId).
                           Défaut : $SIMULATOR_PASSWORD
  --topic-prefix <prefix>  Défaut : campus
  --interval <ms>          Défaut : 2000 (cadence observée du kit)
  --qos <0|1>               Défaut : 0
  --retain                  Publie chaque message avec le flag retained
  --duplicate-rate <0..1>   Probabilité de republier le même message_id juste après (retransmission simulée). Défaut : 0
  --co2-spike <ids>         Scénario d'alerte J5 reproductible (ADR 0015) : ces devices font un pic de CO2
                            600 → 1200 → 800 ppm sur ~2 min (une alerte, un retour à la normale), tous les
                            autres restent à ~600 ppm et 20–24 °C (aucune alerte). Indépendant de --interval.

Commandes (J4, voir docs/decisions/0014-cycle-de-vie-des-commandes.md) :
  --command-mode <mode>     normal (défaut) : exécute puis acquitte
                            silent : reçoit et journalise, n'exécute rien, n'acquitte pas (objet silencieux)
                            reject : refuse toute commande (ACK "rejected")
  --drop-ack                Exécute la commande mais N'ENVOIE PAS l'ACK (ACK perdu)
  --ack-delay <ms>          Retarde l'envoi de l'ACK (ex. 25000 → ACK tardif après le timeout). Défaut : 0
  --redeliver               Retraite chaque commande reçue une 2e fois 1 s après (redélivrance QoS 1 simulée)
  --persistent-session      Session MQTT persistante (clientId stable, clean=false) : les commandes publiées
                            pendant une coupure du simulateur sont livrées à son retour
  --help                    Affiche cette aide

Exemples :
  npm run simulate:devices -- --password changeme-local-only
  npm run simulate:devices -- --password changeme-local-only --devices sensor-001 --qos 1 --duplicate-rate 0.2
  npm run simulate:devices -- --password changeme-local-only --devices sensor-001 --drop-ack
  npm run simulate:devices -- --password changeme-local-only --devices sensor-001 --ack-delay 25000
  docker compose run --rm simulator --devices sensor-001 --redeliver
  npm run simulate:devices -- --password changeme-local-only --co2-spike sensor-001 --interval 100 --qos 1
`

function parseOptions(argv: string[]): SimulatorOptions | null {
  const { values } = parseArgs({
    args: argv,
    options: {
      broker: { type: 'string', default: process.env.MQTT_URL ?? 'mqtt://localhost:1883' },
      devices: { type: 'string', default: 'sensor-001,sensor-002,sensor-003' },
      rooms: { type: 'string', default: 'salle-203,salle-204,salle-205' },
      password: { type: 'string', default: process.env.SIMULATOR_PASSWORD ?? '' },
      'topic-prefix': { type: 'string', default: 'campus' },
      interval: { type: 'string', default: '2000' },
      qos: { type: 'string', default: '0' },
      retain: { type: 'boolean', default: false },
      'duplicate-rate': { type: 'string', default: '0' },
      'command-mode': { type: 'string', default: 'normal' },
      'drop-ack': { type: 'boolean', default: false },
      'ack-delay': { type: 'string', default: '0' },
      redeliver: { type: 'boolean', default: false },
      'persistent-session': { type: 'boolean', default: false },
      'co2-spike': { type: 'string' },
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

  const commandMode = values['command-mode']
  if (commandMode !== 'normal' && commandMode !== 'silent' && commandMode !== 'reject') {
    throw new Error(`--command-mode doit valoir normal, silent ou reject (reçu: ${commandMode})`)
  }

  return {
    broker: values.broker!,
    devices,
    password: values.password!,
    topicPrefix: values['topic-prefix']!,
    intervalMs: Number(values.interval),
    qos,
    retain: Boolean(values.retain),
    duplicateRate: Number(values['duplicate-rate']),
    commandMode,
    dropAck: Boolean(values['drop-ack']),
    ackDelayMs: Number(values['ack-delay']),
    redeliver: Boolean(values.redeliver),
    persistentSession: Boolean(values['persistent-session']),
    co2Spike: values['co2-spike'] === undefined ? null : values['co2-spike'].split(',').map((s) => s.trim()).filter(Boolean)
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

function runTelemetry(client: MqttClient, device: DeviceSpec, state: DeviceState, opts: SimulatorOptions): () => void {
  const bootId = randomUUID().replace(/-/g, '')
  let counter = 0
  let temperature = 20 + Math.random() * 3
  let co2 = 500 + Math.random() * 300
  const topic = `${opts.topicPrefix}/v1/devices/${device.id}/telemetry`
  const startedAt = Date.now()
  const profile: Co2Profile | null = opts.co2Spike === null ? null : opts.co2Spike.includes(device.id) ? 'spike' : 'calm'

  const publishOnce = () => {
    counter += 1
    if (profile !== null) {
      // Scénario J5 : CO2 déterministe (co2Scenario.ts), température bornée
      // loin des seuils 16/28 °C — seule l'alerte CO2 voulue doit s'ouvrir.
      temperature = nextValue(temperature, 20, 24, 0.2)
      co2 = co2At(profile, Date.now() - startedAt, Math.random() * 2 - 1)
    } else {
      temperature = nextValue(temperature, 15, 30, 0.4)
      // Effet physique de la ventilation (ADR 0014, preuve indépendante de
      // l'ACK) : allumée, le CO2 baisse nettement ; éteinte, il remonte.
      co2 = nextValue(co2 + (state.ventilation === 'on' ? -60 : 15), 400, 2500, 40)
    }
    const messageId = `${bootId}-${counter}`
    const payload = JSON.stringify(buildPayload(device, bootId, counter, temperature, co2))

    client.publish(topic, payload, { qos: opts.qos, retain: opts.retain }, (err) => {
      if (err) {
        log('error', 'telemetry publish failed', { eventType: 'telemetry', deviceId: device.id, eventId: messageId, status: 'error', error: err.message })
        return
      }
      log('info', 'telemetry published', {
        eventType: 'telemetry',
        deviceId: device.id,
        eventId: messageId,
        status: 'published',
        temperature: Math.round(temperature * 100) / 100,
        co2: Math.round(co2),
        ventilation: state.ventilation
      })
    })

    if (Math.random() < opts.duplicateRate) {
      setTimeout(() => {
        // Même message_id, même payload : simule une retransmission MQTT
        // exacte (QoS ≥ 1) — c'est précisément ce que la dédup doit rejeter.
        client.publish(topic, payload, { qos: opts.qos, retain: opts.retain }, (err) => {
          if (err) return
          log('info', 'telemetry duplicate published', { eventType: 'telemetry', deviceId: device.id, eventId: messageId, status: 'duplicate_published' })
        })
      }, 50)
    }
  }

  publishOnce()
  const interval = setInterval(publishOnce, opts.intervalMs)
  return () => clearInterval(interval)
}

const COMMAND_EVENT_TYPE = 'command_lifecycle'

/**
 * Câble le DeviceCommandHandler sur MQTT : réception sur
 * `{prefix}/v1/devices/{id}/commands`, ACK sur `.../commands/ack` (QoS 1).
 * Les options d'anomalie n'agissent QUE sur le transport (ACK retenu,
 * retardé, commande retraitée) — la logique de l'objet reste celle du
 * handler, la même dans tous les scénarios.
 */
function attachCommands(client: MqttClient, device: DeviceSpec, handler: DeviceCommandHandler, opts: SimulatorOptions): void {
  const commandTopic = `${opts.topicPrefix}/v1/devices/${device.id}/commands`
  const ackTopic = `${commandTopic}/ack`

  const sendAck = (result: Extract<HandleResult, { ack: unknown }>, delivery: string) => {
    const meta = { eventType: COMMAND_EVENT_TYPE, deviceId: device.id, commandId: result.command.command_id, delivery, ackStatus: result.ack.status }
    if (opts.dropAck) {
      log('warn', 'ack dropped (simulated loss)', { ...meta, status: 'ack_dropped', reason: 'simulated_ack_loss' })
      return
    }
    const publish = () => {
      client.publish(ackTopic, JSON.stringify(result.ack), { qos: 1 }, (err) => {
        if (err) {
          log('error', 'ack publish failed', { ...meta, status: 'error', error: err.message })
          return
        }
        log('info', 'ack sent', { ...meta, status: 'ack_sent' })
      })
    }
    if (opts.ackDelayMs > 0) {
      log('warn', 'ack delayed (simulated)', { ...meta, status: 'ack_delayed', reason: 'simulated_ack_delay', delayMs: opts.ackDelayMs })
      setTimeout(publish, opts.ackDelayMs)
    } else {
      publish()
    }
  }

  const handleCommand = (payload: string, delivery: 'first' | 'redelivery') => {
    const result = handler.handle(payload)
    const base = { eventType: COMMAND_EVENT_TYPE, deviceId: device.id, delivery }

    switch (result.kind) {
      case 'invalid':
        log('warn', 'command ignored: unreadable', { ...base, status: 'invalid', reason: result.reason })
        return
      case 'ignored':
        log('warn', 'command received but ignored (silent mode)', {
          ...base,
          commandId: result.command.command_id,
          commandType: result.command.type,
          status: 'ignored',
          reason: 'simulated_silent_device'
        })
        return
      case 'duplicate':
        log('warn', 'command already processed: not executed again, same ack re-sent', {
          ...base,
          commandId: result.command.command_id,
          status: 'duplicate',
          reason: 'duplicate_command'
        })
        sendAck(result, delivery)
        return
      default:
        log(result.kind === 'executed' ? 'info' : 'warn', `command ${result.kind}`, {
          ...base,
          commandId: result.command.command_id,
          commandType: result.command.type,
          params: result.command.params,
          status: result.kind,
          reason: result.ack.reason ?? undefined,
          state: result.ack.state,
          expiresAt: result.command.expires_at
        })
        sendAck(result, delivery)
    }
  }

  client.on('message', (topic, payload, packet) => {
    if (topic !== commandTopic) return
    const text = payload.toString()
    let commandId: unknown
    try {
      commandId = (JSON.parse(text) as { command_id?: unknown }).command_id
    } catch {
      commandId = undefined
    }
    log('info', 'command received', { eventType: COMMAND_EVENT_TYPE, deviceId: device.id, commandId, status: 'received', mqttDup: packet.dup })
    handleCommand(text, 'first')
    if (opts.redeliver) {
      // Redélivrance QoS 1 simulée : même message, même command_id.
      setTimeout(() => {
        log('warn', 'command redelivered (simulated)', { eventType: COMMAND_EVENT_TYPE, deviceId: device.id, commandId, status: 'received', delivery: 'redelivery' })
        handleCommand(text, 'redelivery')
      }, 1000)
    }
  })
}

function main(): void {
  const opts = parseOptions(process.argv.slice(2))
  if (opts === null) return // --help déjà affiché

  if (!opts.password) {
    console.error('--password (ou $SIMULATOR_PASSWORD) est requis (voir backend/README.md pour générer les identifiants mosquitto)')
    process.exitCode = 1
    return
  }

  log('info', 'simulator starting', {
    devices: opts.devices.map((d) => d.id),
    broker: opts.broker.replace(/\/\/[^@]*@/, '//***@'),
    qos: opts.qos,
    intervalMs: opts.intervalMs,
    commandMode: opts.commandMode,
    dropAck: opts.dropAck,
    ackDelayMs: opts.ackDelayMs,
    redeliver: opts.redeliver,
    persistentSession: opts.persistentSession
  })

  const stopFns: Array<() => void> = []
  const clients: MqttClient[] = []

  for (const device of opts.devices) {
    const client = mqtt.connect(opts.broker, {
      username: device.id,
      password: opts.password,
      // Session persistante : le broker garde l'abonnement aux commandes et
      // met en file ce qui arrive pendant une coupure (QoS 1) — c'est ce qui
      // permet de démontrer une livraison tardive → ACK `expired`.
      ...(opts.persistentSession ? { clientId: `campify-sim-${device.id}`, clean: false } : {})
    })
    clients.push(client)

    const state: DeviceState = { ventilation: 'off', target_temperature: null }
    const handler = new DeviceCommandHandler(state, opts.commandMode)
    attachCommands(client, device, handler, opts)

    // mqtt.js réémet 'connect' à chaque reconnexion (pas seulement la
    // première) — sans ce garde, une coupure/reprise du broker démarrerait
    // un second intervalle de publication en plus du premier (jamais
    // arrêté), doublant silencieusement le débit. Un seul `runTelemetry`
    // par device, quel que soit le nombre de reconnexions. L'abonnement aux
    // commandes, lui, est refait à chaque connexion (sans effet si la
    // session persistante l'a conservé).
    let started = false
    client.on('connect', (packet) => {
      log('info', 'device connected', { eventType: 'mqtt_connection', deviceId: device.id, status: 'connected', sessionResumed: packet.sessionPresent })
      client.subscribe(`${opts.topicPrefix}/v1/devices/${device.id}/commands`, { qos: 1 }, (err) => {
        if (err) log('error', 'command subscribe failed', { eventType: 'mqtt_connection', deviceId: device.id, status: 'subscribe_failed', error: err.message })
      })
      if (started) return
      started = true
      stopFns.push(runTelemetry(client, device, state, opts))
    })

    client.on('error', (err) => {
      log('error', 'mqtt error', { eventType: 'mqtt_connection', deviceId: device.id, status: 'error', error: err.message })
    })
  }

  const shutdown = () => {
    log('info', 'simulator stopping')
    for (const stop of stopFns) stop()
    for (const client of clients) client.end()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
