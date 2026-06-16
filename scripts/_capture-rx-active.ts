/**
 * JETABLE — session PROPRE (seul opérateur). Repart du repos, tente une vraie
 * réception (multicast puis repli unicast RTSP), capture l'état ACTIF avec
 * métriques réelles, puis restaure. Cible .9 Receiver.
 *   NVX_HOST=192.168.2.9 NVX_USER=… NVX_PASS=… node --experimental-transform-types \
 *     --no-warnings --loader ./scripts/ts-resolver.mjs scripts/_capture-rx-active.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { NvxApiClient } from '../src/api.js'
import { ModuleLogger } from '../src/logger.js'
import type { ModuleConfig, ModuleSecrets } from '../src/config.js'
import type { LogLevel } from '@companion-module/base'

const HOST = process.env['NVX_HOST'] ?? '192.168.2.9'
const USER = process.env['NVX_USER'] ?? 'didier'
const PASS = process.env['NVX_PASS'] ?? ''
const MCAST = process.env['SRC_MCAST'] ?? '239.1.1.4'
const RTSP = process.env['SRC_RTSP'] ?? 'rtsp://192.168.2.10:554/live.sdp'
const OUTDIR = path.resolve(process.cwd(), process.env['RX_OUTDIR'] ?? 'docs/hardware-validation/raw/2026-06-16-rx-receiving')
if (!PASS) { console.error('NVX_PASS requis'); process.exit(1) }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = new ModuleLogger((l: LogLevel, m: string) => console.log(`[${l}] ${m}`), '[rx]', false)
const body = (props: Record<string, unknown>) => ({ Device: { StreamReceive: { Streams: [props] } } })
const s0 = (j: any): Record<string, unknown> => j.Device.StreamReceive.Streams[0]
const KEYS = ['Status', 'SessionInitiation', 'MulticastAddress', 'StreamLocation', 'Start', 'Stop', 'Processing', 'HorizontalResolution', 'VerticalResolution', 'FramesPerSecond', 'Bitrate', 'AudioFormat', 'VideoFormat', 'CodecReady', 'NumVideoPacketsRcvd', 'NumAudioPacketsRcvd', 'ElapsedSeconds']
const show = (tag: string, s: Record<string, unknown>) => { console.log(`\n[rx] ── ${tag} ──`); for (const k of KEYS) console.log('   ', k.padEnd(22), JSON.stringify(s[k])) }
const receiving = (s: Record<string, unknown>): boolean => s.CodecReady === true || Number(s.NumVideoPacketsRcvd) > 0 || Number(s.HorizontalResolution) > 0

async function main(): Promise<void> {
  const config: ModuleConfig = { host: HOST, port: 443, username: USER, pollInterval: 2000, ignoreSelfSignedCert: true, verbose: false }
  const client = new NvxApiClient(config, { password: PASS } as ModuleSecrets, log.child('[AUTH]'), log.child('[HTTP]'))
  await client.login()
  console.log(`[rx] Auth OK ${HOST}`)

  // 0) Repartir du repos
  console.log('[rx] reset → Stop + clear source'); await client.postSetPartial(body({ Start: false, Stop: true })); await client.postSetPartial(body({ StreamLocation: '', MulticastAddress: '' })); await sleep(2500)
  show('REPOS', s0(await client.get<any>('/Device/StreamReceive')))

  // 1) Tentative MULTICAST
  console.log(`\n[rx] tentative MULTICAST ${MCAST}`); await client.postSetPartial(body({ SessionInitiation: 'Multicast via RTSP', MulticastAddress: MCAST, Start: true, Stop: false })); await sleep(9000)
  let active = s0(await client.get<any>('/Device/StreamReceive'))
  show('après MULTICAST (9s)', active)

  // 2) Repli UNICAST RTSP si rien reçu
  if (!receiving(active)) {
    console.log(`\n[rx] 0 réception en multicast → repli UNICAST ${RTSP}`)
    await client.postSetPartial(body({ Stop: true })); await client.postSetPartial(body({ MulticastAddress: '' })); await sleep(2000)
    await client.postSetPartial(body({ SessionInitiation: 'ByReceiver', StreamLocation: RTSP, Start: true, Stop: false })); await sleep(9000)
    active = s0(await client.get<any>('/Device/StreamReceive'))
    show('après UNICAST (9s)', active)
  }

  // 3) Capture (quel que soit le résultat — on documente)
  fs.mkdirSync(OUTDIR, { recursive: true })
  const sr = await client.get<any>('/Device/StreamReceive')
  fs.writeFileSync(path.join(OUTDIR, 'Device_StreamReceive.json'), JSON.stringify(sr, null, 2))
  for (const ep of ['AudioVideoInputOutput', 'NaxAudio', 'DiscoveredStreams']) {
    try { fs.writeFileSync(path.join(OUTDIR, `Device_${ep}.json`), JSON.stringify(await client.get<any>(`/Device/${ep}`), null, 2)) } catch (e) { console.log(`[rx] ${ep}: ${(e as Error).message}`) }
  }
  console.log(`\n[rx] RÉCEPTION RÉELLE ? ${receiving(s0(sr)) ? 'OUI ✓ (métriques ≠ 0)' : '⚠️ NON (toujours 0 paquet/0 résolution)'}`)

  // 4) Restauration repos propre
  console.log('\n[rx] restauration → Stop + clear'); await client.postSetPartial(body({ Start: false, Stop: true })); await client.postSetPartial(body({ StreamLocation: '', MulticastAddress: '' })); await sleep(2500)
  show('RESTAURÉ', s0(await client.get<any>('/Device/StreamReceive')))
  await client.logout()
  console.log('\n[rx] terminé.')
  process.exit(0)
}
main().catch((e: unknown) => { console.error('[rx] ERREUR :', (e as Error).message); process.exit(1) })
