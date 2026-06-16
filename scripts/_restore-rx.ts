/** JETABLE — ramène StreamReceive.Streams[0] du .9 au repos propre. */
import { NvxApiClient } from '../src/api.js'
import { ModuleLogger } from '../src/logger.js'
import type { ModuleConfig, ModuleSecrets } from '../src/config.js'
import type { LogLevel } from '@companion-module/base'

const HOST = process.env['NVX_HOST'] ?? '192.168.2.9'
const USER = process.env['NVX_USER'] ?? 'didier'
const PASS = process.env['NVX_PASS'] ?? ''
if (!PASS) { console.error('NVX_PASS requis'); process.exit(1) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = new ModuleLogger((l: LogLevel, m: string) => console.log(`[${l}] ${m}`), '[restore]', false)
const body = (props: Record<string, unknown>) => ({ Device: { StreamReceive: { Streams: [props] } } })
const KEYS = ['Status', 'SessionInitiation', 'MulticastAddress', 'StreamLocation', 'Start', 'Stop', 'Processing']
const show = (tag: string, s: any) => { console.log(`\n[restore] ── ${tag} ──`); for (const k of KEYS) console.log('   ', k.padEnd(20), JSON.stringify(s[k])) }

async function main(): Promise<void> {
  const config: ModuleConfig = { host: HOST, port: 443, username: USER, pollInterval: 2000, ignoreSelfSignedCert: true, verbose: false }
  const client = new NvxApiClient(config, { password: PASS } as ModuleSecrets, log.child('[AUTH]'), log.child('[HTTP]'))
  await client.login()

  // 1) Stop franc (Start=false + Stop=true ensemble)
  console.log('[restore] POST {Start:false, Stop:true}'); await client.postSetPartial(body({ Start: false, Stop: true })); await sleep(2500)
  // 2) Vider la source
  console.log('[restore] POST {StreamLocation:"", MulticastAddress:""}'); await client.postSetPartial(body({ StreamLocation: '', MulticastAddress: '' })); await sleep(2000)

  const s = (await client.get<any>('/Device/StreamReceive')).Device.StreamReceive.Streams[0]
  show('ÉTAT FINAL', s)
  const clean = s.Status === 'Stream Stopped' && s.MulticastAddress === '' && s.StreamLocation === ''
  console.log(`\n[restore] PROPRE ? ${clean ? 'OUI ✓' : '⚠️ NON — état résiduel, voir ci-dessus'}`)
  await client.logout()
  process.exit(clean ? 0 : 2)
}
main().catch((e: unknown) => { console.error('[restore] ERREUR :', (e as Error).message); process.exit(1) })
