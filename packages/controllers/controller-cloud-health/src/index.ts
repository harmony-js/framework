import { Controller } from '@harmonyjs/types-server'
import { ILogger } from '@harmonyjs/logger'

import Fastify, { FastifyInstance } from 'fastify'
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
    startup?: (() => Promise<void>)[]
    liveness?: (() => Promise<void>)[]
    readiness?: (() => Promise<void>)[]
    shutdown?: (() => Promise<void>)[]
  }
}

type ControllerCloudHealthProperties = {
  registerStartupCheck(check: () => Promise<void>, name?: string): void
  registerLivenessCheck(check: () => Promise<void>, name?: string): void
  registerReadinessCheck(check: () => Promise<void>, name?: string): void
  registerShutdownCheck(check: () => Promise<void>, name?: string): void
}

enum StateCode {
    OK = 200,
    DOWN = 503,
    ERRORED = 500
}

function HealthEndpoint(checker: HealthChecker): Fastify.RequestHandler {
  return function (req, res) {
    // Set errored by default, will be overwritten if not in error
    res.status(StateCode.ERRORED)
    return checker.getStatus()
      .then((status) => {
        switch (status.status) {
          case State.STARTING: res.status(StateCode.DOWN); break
          case State.UP: res.status(StateCode.OK); break
          case State.DOWN: res.status(StateCode.DOWN); break
          case State.STOPPING: res.status(StateCode.DOWN); break
          case State.STOPPED: res.status(StateCode.DOWN); break
          default: res.status(StateCode.ERRORED); break
        }

        return status
      })
      .catch(() => null)
  }
}

function LivenessEndpoint(checker: HealthChecker): Fastify.RequestHandler {
  return function (req, res) {
    // Set errored by default, will be overwritten if not in error
    res.status(StateCode.ERRORED)
    return checker.getStatus()
      .then((status) => {
        switch (status.status) {
          case State.STARTING: res.status(StateCode.OK); break
          case State.UP: res.status(StateCode.OK); break
          case State.DOWN: res.status(StateCode.DOWN); break
          case State.STOPPING: res.status(StateCode.DOWN); break
          case State.STOPPED: res.status(StateCode.DOWN); break
          default: res.status(StateCode.ERRORED); break
        }

        return status
      })
      .catch(() => null)
  }
}

function ReadinessEndpoint(checker: HealthChecker): Fastify.RequestHandler {
  return function (req, res) {
    // Set errored by default, will be overwritten if not in error
    res.status(StateCode.ERRORED)
    return checker.getStatus()
      .then((status) => {
        switch (status.status) {
          case State.STARTING: res.status(StateCode.DOWN); break
          case State.UP: res.status(StateCode.OK); break
          case State.DOWN: res.status(StateCode.DOWN); break
          case State.STOPPING: res.status(StateCode.DOWN); break
          case State.STOPPED: res.status(StateCode.DOWN); break
          default: res.status(StateCode.ERRORED); break
        }

        return status
      })
      .catch(() => null)
  }
}


function wrap(path: string = ''): string {
  if (!path) {
    return ''
  }

  if (path.startsWith('/')) {
    return path
  }

  return `/${path}`
}

const ControllerCloudHealth : Controller<ControllerCloudHealthConfig, ControllerCloudHealthProperties> & {
  startupLock(): { lock: Promise<void>, release(): void }
} = function ControllerCloudHealth(config) {
  const readinessPath = config.readinessPath || '/ready'
  const livenessPath = config.livenessPath || '/live'
  const healthPath = config.healthPath || '/health'

  const healthcheck = new health.HealthChecker()
  const standalone = config.standalone ? Fastify() : null;

  (config.checks.startup || []).forEach((check, i) => {
    healthcheck.registerStartupCheck(new health.StartupCheck(`startup_${i}`, check))
  });

  (config.checks.liveness || []).forEach((check, i) => {
    healthcheck.registerLivenessCheck(new health.LivenessCheck(`liveness_${i}`, check))
  });

  (config.checks.readiness || []).forEach((check, i) => {
    healthcheck.registerReadinessCheck(new health.ReadinessCheck(`readiness_${i}`, check))
  });

  (config.checks.shutdown || []).forEach((check, i) => {
    healthcheck.registerShutdownCheck(new health.ShutdownCheck(`shutdown_${i}`, check))
  })

  const registerProbes = (instance : FastifyInstance) => {
    instance.register((fastify, opts, done) => {
      fastify.get(wrap(livenessPath), LivenessEndpoint(healthcheck))
      fastify.get(wrap(readinessPath), ReadinessEndpoint(healthcheck))
      fastify.get(wrap(healthPath), HealthEndpoint(healthcheck))

      done()
    }, {
      prefix: config.prefix,
    })
  }

  const logProbes = (logger : ILogger) => {
    logger.info(`Registered liveness probe on path ${wrap(config.prefix)}${wrap(livenessPath)}`)
    logger.info(`Registered readiness probe on path ${wrap(config.prefix)}${wrap(readinessPath)}`)
    logger.info(`Registered health probe on path ${wrap(config.prefix)}${wrap(healthPath)}`)
  }

  if (config.standalone) {
    registerProbes(standalone!)
    standalone!.listen(config.standalone.port, config.standalone.host)
  }

  return ({
    name: 'ControllerCloudHealth',

    registerStartupCheck(check, name) {
      healthcheck.registerStartupCheck(new health.StartupCheck(name || 'startup', check))
    },
    registerLivenessCheck(check, name) {
      healthcheck.registerLivenessCheck(new health.LivenessCheck(name || 'liveness', check))
    },
    registerReadinessCheck(check, name) {
      healthcheck.registerReadinessCheck(new health.ReadinessCheck(name || 'readiness', check))
    },
    registerShutdownCheck(check, name) {
      healthcheck.registerShutdownCheck(new health.ShutdownCheck(name || 'shutdown', check))
    },

    async initialize({ logger, server }) {
      if (!config.standalone) {
        registerProbes(server)
      }
      logProbes(logger)
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
