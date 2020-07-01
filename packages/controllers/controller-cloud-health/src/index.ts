import { Controller } from '@harmonyjs/types-server'
import { ILogger } from '@harmonyjs/logger'

import Fastify, { FastifyInstance } from 'fastify'
import * as health from '@cloudnative/health'
import { HealthChecker, State } from '@cloudnative/health'
import Prometheus from 'prom-client'

type ControllerCloudHealthCheck = ([string, () => Promise<void>]) | (() => Promise<void>)

type ControllerCloudHealthConfig = {
  prefix?: string
  readinessPath?: string
  livenessPath?: string
  healthPath?: string
  statsPath?: string

  standalone?: {
    host: string
    port: number
  }

  checks?: {
    startup?: ControllerCloudHealthCheck[]
    liveness?: ControllerCloudHealthCheck[]
    readiness?: ControllerCloudHealthCheck[]
    shutdown?: ControllerCloudHealthCheck[]
  }

  stats?: {
    disable: boolean
    defaultMetrics: boolean
  }
}

type ControllerCloudHealthProperties = {
  registerStartupCheck(name: string, check: () => Promise<void>): void
  registerLivenessCheck(name: string, check: () => Promise<void>): void
  registerReadinessCheck(name: string, check: () => Promise<void>): void
  registerShutdownCheck(name: string, check: () => Promise<void>): void
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

function StatsEndpoint(checker: HealthChecker, register: Prometheus.Registry): Fastify.RequestHandler {
  return async function () {
    await checker.getStatus()
    return register.metrics()
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
  const statsPath = config.statsPath || '/stats'

  const healthcheck = new health.HealthChecker()
  const register = new Prometheus.Registry()
  if (config.stats?.defaultMetrics) {
    Prometheus.collectDefaultMetrics({ register })
  }

  const statWrap = (name: string, promiseGenerator : () => Promise<void>, kind: string = 'Health')
    : [string, () => Promise<void>] => {
    if (config.stats?.disable) {
      return [name, promiseGenerator]
    }

    const gauge = new Prometheus.Gauge({ name, help: `${kind} Check` })
    gauge.set(0)
    register.registerMetric(gauge)

    return [name, () => new Promise((resolve, reject) => {
      promiseGenerator()
        .then(() => {
          gauge.set(1)
          resolve()
        })
        .catch((err) => {
          gauge.set(0)
          reject(err)
        })
    })]
  }

  const standalone = config.standalone ? Fastify() : null;

  (config.checks?.startup || [])
    .map((check, i) => (Array.isArray(check) ? check : [`startup_${i}`, check]) as [string, () => Promise<void>])
    .forEach((check, i) => {
      healthcheck.registerStartupCheck(
        new health.StartupCheck(...statWrap(check[0] || `startup_${i}`, check[1], 'Startup')),
      )
    });

  (config.checks?.liveness || [])
    .map((check, i) => (Array.isArray(check) ? check : [`liveness_${i}`, check]) as [string, () => Promise<void>])
    .forEach((check, i) => {
      healthcheck.registerLivenessCheck(
        new health.LivenessCheck(...statWrap(check[0] || `liveness_${i}`, check[1], 'Liveness')),
      )
    });

  (config.checks?.readiness || [])
    .map((check, i) => (Array.isArray(check) ? check : [`readiness_${i}`, check]) as [string, () => Promise<void>])
    .forEach((check, i) => {
      healthcheck.registerReadinessCheck(
        new health.ReadinessCheck(...statWrap(check[0] || `readiness_${i}`, check[1], 'Readiness')),
      )
    });

  (config.checks?.shutdown || [])
    .map((check, i) => (Array.isArray(check) ? check : [`shutdown_${i}`, check]) as [string, () => Promise<void>])
    .forEach((check, i) => {
      healthcheck.registerShutdownCheck(new health.ShutdownCheck(check[0] || `shutdown_${i}`, check[1]))
    })

  const registerProbes = (instance : FastifyInstance) => {
    instance.register((fastify, opts, done) => {
      fastify.get(wrap(livenessPath), LivenessEndpoint(healthcheck))
      fastify.get(wrap(readinessPath), ReadinessEndpoint(healthcheck))
      fastify.get(wrap(healthPath), HealthEndpoint(healthcheck))
      fastify.get(wrap(statsPath), StatsEndpoint(healthcheck, register))

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

    registerStartupCheck(name, check) {
      healthcheck.registerStartupCheck(new health.StartupCheck(...statWrap(name || 'startup', check)))
    },
    registerLivenessCheck(name, check) {
      healthcheck.registerLivenessCheck(new health.LivenessCheck(...statWrap(name || 'liveness', check)))
    },
    registerReadinessCheck(name, check) {
      healthcheck.registerReadinessCheck(new health.ReadinessCheck(...statWrap(name || 'readiness', check)))
    },
    registerShutdownCheck(name, check) {
      healthcheck.registerShutdownCheck(new health.ShutdownCheck(...statWrap(name || 'shutdown', check)))
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
