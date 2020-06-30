import { Controller } from '@harmonyjs/types-server'

import Fastify from 'fastify'
import * as health from '@cloudnative/health'
import { HealthChecker, State } from '@cloudnative/health'

type ControllerCloudHealthConfig = {
  prefix?: string
  readinessPath?: string
  livenessPath?: string
  healthPath?: string

  standalone?: {
    host: string
    port: number
  }

  checks: {
    startup: (() => Promise<void>)[]
    liveness: (() => Promise<void>)[]
    readiness: (() => Promise<void>)[]
    shutdown: (() => Promise<void>)[]
  }
}

enum StateCode {
    OK = 200,
    DOWN = 503,
    ERRORED = 500
}

function HealthEndpoint(checker: HealthChecker): Fastify.RequestHandler {
  return function (req, res) {
    return checker.getStatus()
      .then((status) => {
        switch (status.status) {
          case State.STARTING: res.status(StateCode.DOWN); break
          case State.UP: res.status(StateCode.OK); break
          case State.DOWN: res.status(StateCode.DOWN); break
          case State.STOPPING: res.status(StateCode.DOWN); break
          case State.STOPPED: res.status(StateCode.DOWN); break
          default: res.status(400); break
        }

        return status
      })
      .catch(() => null)
  }
}

function LivenessEndpoint(checker: HealthChecker): Fastify.RequestHandler {
  return function (req, res) {
    return checker.getStatus()
      .then((status) => {
        switch (status.status) {
          case State.STARTING: res.status(StateCode.OK); break
          case State.UP: res.status(StateCode.OK); break
          case State.DOWN: res.status(StateCode.DOWN); break
          case State.STOPPING: res.status(StateCode.DOWN); break
          case State.STOPPED: res.status(StateCode.DOWN); break
          default: res.status(400); break
        }

        return status
      })
      .catch(() => null)
  }
}

function ReadinessEndpoint(checker: HealthChecker): Fastify.RequestHandler {
  return function (req, res) {
    return checker.getStatus()
      .then((status) => {
        switch (status.status) {
          case State.STARTING: res.status(StateCode.DOWN); break
          case State.UP: res.status(StateCode.OK); break
          case State.DOWN: res.status(StateCode.DOWN); break
          case State.STOPPING: res.status(StateCode.DOWN); break
          case State.STOPPED: res.status(StateCode.DOWN); break
          default: res.status(StateCode.OK); break
        }

        return status
      })
      .catch(() => null)
  }
}


function wrap(path: string): string {
  if (path.startsWith('/')) {
    return path
  }

  return `/${path}`
}

const ControllerCloudHealth : Controller<ControllerCloudHealthConfig> & {
  startupLock(): { lock: Promise<void>, release(): void }
} = function ControllerCloudHealth(config) {
  return ({
    name: 'ControllerCloudHealth',
    async initialize({ logger, server }) {
      const readinessPath = config.readinessPath || '/ready'
      const livenessPath = config.livenessPath || '/live'
      const healthPath = config.healthPath || '/health'

      const healthcheck = new health.HealthChecker()

      const instance = config.standalone ? Fastify() : server

      instance.register((fastify, opts, done) => {
        logger.info(`Registering liveness probe on path ${wrap(livenessPath)}`)
        fastify.get(wrap(livenessPath), LivenessEndpoint(healthcheck))
        logger.info(`Registering readiness probe on path ${wrap(readinessPath)}`)
        fastify.get(wrap(readinessPath), ReadinessEndpoint(healthcheck))
        logger.info(`Registering health probe on path ${wrap(healthPath)}`)
        fastify.get(wrap(healthPath), HealthEndpoint(healthcheck))

        logger.info('All probes registered')

        done()
      }, {
        prefix: config.prefix,
      })

      config.checks.startup.forEach((check, i) => {
        healthcheck.registerStartupCheck(new health.StartupCheck(`startup_${i}`, check))
      })

      config.checks.liveness.forEach((check, i) => {
        healthcheck.registerLivenessCheck(new health.LivenessCheck(`liveness_${i}`, check))
      })

      config.checks.readiness.forEach((check, i) => {
        healthcheck.registerReadinessCheck(new health.ReadinessCheck(`readiness_${i}`, check))
      })

      config.checks.shutdown.forEach((check, i) => {
        healthcheck.registerShutdownCheck(new health.ShutdownCheck(`shutdown_${i}`, check))
      })

      if (config.standalone) {
        instance.listen(config.standalone.port, config.standalone.host)
      }
    },
  })
}

ControllerCloudHealth.startupLock = () => {
  let release = () => {}
  const lock = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    lock,
    release,
  }
}

export default ControllerCloudHealth
