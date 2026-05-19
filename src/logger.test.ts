import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ModuleLogger } from './logger.js'

type Call = { level: string; message: string }

function makeLogger(verbose: boolean): { log: ModuleLogger; calls: Call[] } {
  const calls: Call[] = []
  const log = new ModuleLogger(
    (level, message) => calls.push({ level, message }),
    '',
    verbose,
  )
  return { log, calls }
}

test('debug() is silent when verbose is false', () => {
  const { log, calls } = makeLogger(false)
  log.debug('test message')
  assert.equal(calls.length, 0)
})

test('debug() logs as info when verbose is true', () => {
  const { log, calls } = makeLogger(true)
  log.debug('test message')
  assert.deepEqual(calls, [{ level: 'info', message: 'test message' }])
})

test('info() always logs regardless of verbose', () => {
  const { log, calls } = makeLogger(false)
  log.info('info message')
  assert.deepEqual(calls, [{ level: 'info', message: 'info message' }])
})

test('warn() always logs regardless of verbose', () => {
  const { log, calls } = makeLogger(false)
  log.warn('warn message')
  assert.deepEqual(calls, [{ level: 'warn', message: 'warn message' }])
})

test('error() always logs regardless of verbose', () => {
  const { log, calls } = makeLogger(false)
  log.error('error message')
  assert.deepEqual(calls, [{ level: 'error', message: 'error message' }])
})

test('child() prepends prefix to messages', () => {
  const { log, calls } = makeLogger(true)
  const child = log.child('[AUTH]')
  child.debug('step 1')
  assert.deepEqual(calls, [{ level: 'info', message: '[AUTH] step 1' }])
})

test('child() with no prefix on parent does not add space', () => {
  const { log, calls } = makeLogger(false)
  const child = log.child('[POLL]')
  child.info('started')
  assert.deepEqual(calls, [{ level: 'info', message: '[POLL] started' }])
})

test('setVerbose(true) enables debug messages', () => {
  const { log, calls } = makeLogger(false)
  log.debug('silent')
  assert.equal(calls.length, 0)
  log.setVerbose(true)
  log.debug('audible')
  assert.deepEqual(calls, [{ level: 'info', message: 'audible' }])
})

test('setVerbose() on parent propagates to child loggers', () => {
  const { log, calls } = makeLogger(false)
  const child = log.child('[CONN]')
  child.debug('silent')
  assert.equal(calls.length, 0)
  log.setVerbose(true)
  child.debug('audible')
  assert.deepEqual(calls, [{ level: 'info', message: '[CONN] audible' }])
})
