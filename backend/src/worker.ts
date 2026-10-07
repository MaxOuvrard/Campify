import 'dotenv/config'
import { startWorker } from './composition'

startWorker()
  .then((app) => {
    const shutdown = (): void => {
      void app.stop().finally(() => process.exit(0))
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
