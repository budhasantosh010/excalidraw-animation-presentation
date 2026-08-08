import handler from 'vinext/server/app-router-entry'

import { createCloudWorker } from './cloud-worker.ts'

const worker = createCloudWorker({
  fallbackFetch: (request, env, context) =>
    handler.fetch(request, env, context),
})

export default worker
