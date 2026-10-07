import 'dotenv/config'
import { startIngester } from './composition'

startIngester()
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
