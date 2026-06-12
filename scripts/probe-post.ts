/**
 * probe-post.ts — Test d'écriture (POST) réversible sur un NVX, pour découvrir
 * l'enveloppe de réponse CresNext (StatusId/Results) et la sémantique d'écriture
 * des tableaux Streams[]. NE CHANGE RIEN DE PERMANENT : enregistre l'état avant,
 * écrit une valeur test sur Streams[0], relit, puis RESTAURE tous les streams.
 *
 * Cible par défaut : 192.168.2.9 (Receiver), dont le StreamTransmit est au repos
 * → impact nul. Lancement :
 *   NVX_HOST=192.168.2.9 NVX_USER=didier NVX_PASS=… \
 *     node --experimental-transform-types --no-warnings \
 *          --loader ./scripts/ts-resolver.mjs scripts/probe-post.ts
 */
import { NvxApiClient } from '../src/api.js'
import { ModuleLogger } from '../src/logger.js'
import type { ModuleConfig, ModuleSecrets } from '../src/config.js'
import type { LogLevel } from '@companion-module/base'

const HOST = process.env['NVX_HOST'] ?? '192.168.2.9'
const USER = process.env['NVX_USER'] ?? 'didier'
const PASS = process.env['NVX_PASS'] ?? ''
if (!PASS) { console.error('NVX_PASS requis'); process.exit(1) }

function consoleFn(level: LogLevel, msg: string): void {
	console.log(`[${level}] ${msg}`)
}

type StreamTx = { Device: { StreamTransmit: { Streams: Array<{ RtspSessionName?: string }> } } }

async function main(): Promise<void> {
	const config: ModuleConfig = { host: HOST, port: 443, username: USER, pollInterval: 2000, ignoreSelfSignedCert: true, verbose: false }
	const secrets: ModuleSecrets = { password: PASS }
	const log = new ModuleLogger(consoleFn, '[probe]', false)
	const client = new NvxApiClient(config, secrets, log.child('[AUTH]'), log.child('[HTTP]'))

	console.log(`\n[probe] Connexion ${HOST} (user ${USER})`)
	await client.login()
	console.log('[probe] Auth OK\n')

	// 1. État AVANT — noms des 4 streams
	const before = await client.get<StreamTx>('/Device/StreamTransmit')
	const origNames = before.Device.StreamTransmit.Streams.map((s) => s.RtspSessionName ?? '')
	console.log('[probe] RtspSessionName AVANT :', JSON.stringify(origNames))

	// 2. ÉCRITURE test sur Streams[0]
	const TEST = 'CAPTURE-TEST-RESTORE-ME'
	console.log(`\n[probe] POST Streams[0].RtspSessionName = ${TEST}`)
	const writeBody = { Device: { StreamTransmit: { Streams: [{ RtspSessionName: TEST }] } } }
	let postResp: unknown
	try {
		postResp = await client.post<unknown>('/Device', writeBody)
		console.log('[probe] ── ENVELOPPE DE RÉPONSE POST ──')
		console.log(JSON.stringify(postResp, null, 2))
	} catch (err) {
		console.log('[probe] POST a levé :', (err as Error).message)
	}

	// 3. RELECTURE
	const after = await client.get<StreamTx>('/Device/StreamTransmit')
	const newNames = after.Device.StreamTransmit.Streams.map((s) => s.RtspSessionName ?? '')
	console.log('\n[probe] RtspSessionName APRÈS :', JSON.stringify(newNames))
	console.log('[probe] Stream[0] modifié ?', newNames[0] !== origNames[0], `(${origNames[0]} → ${newNames[0]})`)

	// 4. RESTAURATION de tous les streams modifiés
	const changed = newNames.map((n, i) => n !== origNames[i] ? i : -1).filter((i) => i >= 0)
	if (changed.length > 0) {
		console.log(`\n[probe] Restauration des streams modifiés : ${JSON.stringify(changed)}`)
		for (const i of changed) {
			const restore = { Device: { StreamTransmit: { Streams: Array.from({ length: i + 1 }, (_, k) => k === i ? { RtspSessionName: origNames[i] } : {}) } } }
			await client.post<unknown>('/Device', restore)
		}
		const restored = await client.get<StreamTx>('/Device/StreamTransmit')
		console.log('[probe] RtspSessionName RESTAURÉ :', JSON.stringify(restored.Device.StreamTransmit.Streams.map((s) => s.RtspSessionName ?? '')))
	} else {
		console.log('\n[probe] Aucun changement détecté — rien à restaurer.')
	}

	await client.logout()
	console.log('\n[probe] Logout — terminé.')
	process.exit(0)
}

main().catch((e: unknown) => { console.error('[probe] Erreur fatale :', (e as Error).message); process.exit(1) })
