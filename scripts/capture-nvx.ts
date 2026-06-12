/**
 * capture-nvx.ts — Capture brute des endpoints Crestron DM NVX
 *
 * But : s'authentifier une fois sur l'appareil réel et capturer le JSON brut
 * de tous les endpoints AV connus. Produit les fixtures pour les tests et
 * pour docs/hardware-validation.md.
 *
 * ── LANCEMENT ────────────────────────────────────────────────────────────────
 *
 *   NVX_PASS=<password> \
 *   node --experimental-transform-types --no-warnings \
 *        --loader ./scripts/ts-resolver.mjs \
 *        scripts/capture-nvx.ts
 *
 * Variables d'environnement :
 *   NVX_HOST     IP/hostname de l'appareil  (défaut : 192.168.2.9)
 *   NVX_PORT     Port HTTPS                  (défaut : 443)
 *   NVX_USER     Nom d'utilisateur           (défaut : admin)
 *   NVX_PASS     Mot de passe                (REQUIS — exit 1 si absent)
 *   NVX_VERBOSE  Activer les logs détaillés  (défaut : off)
 *
 * ── SÉCURITÉ ──────────────────────────────────────────────────────────────────
 *
 * Aucun retry sur l'authentification. Le compte NVX se verrouille après un
 * nombre limité d'échecs (15 min / 24 h / reset USB selon le firmware).
 * Un échec de login arrête le script immédiatement — aucune tentative répétée.
 *
 * ── SORTIE ───────────────────────────────────────────────────────────────────
 *
 * Chaque endpoint capturé est écrit dans :
 *   docs/hardware-validation/raw/<endpoint-sanitisé>.json
 *
 * Exemple : /Device/StreamTransmit → Device_StreamTransmit.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { NvxApiClient, NvxAuthError } from '../src/api.js'
import { ModuleLogger } from '../src/logger.js'
import type { ModuleConfig, ModuleSecrets } from '../src/config.js'
import type { LogLevel } from '@companion-module/base'

// ── Configuration depuis l'environnement ─────────────────────────────────────

const NVX_HOST = process.env['NVX_HOST'] ?? '192.168.2.9'
const NVX_PORT = parseInt(process.env['NVX_PORT'] ?? '443', 10)
const NVX_USER = process.env['NVX_USER'] ?? 'admin'
const NVX_PASS = process.env['NVX_PASS'] ?? ''
const NVX_VERBOSE = Boolean(process.env['NVX_VERBOSE'])
const NVX_OUTDIR = process.env['NVX_OUTDIR'] ?? ''
const NVX_ALL = Boolean(process.env['NVX_ALL'])

if (!NVX_PASS) {
	console.error('[capture-nvx] ERREUR : NVX_PASS est requis.')
	console.error('  Exemple : NVX_PASS=<password> node --experimental-transform-types --no-warnings --loader ./scripts/ts-resolver.mjs scripts/capture-nvx.ts')
	process.exit(1)
}

// ── Endpoints à capturer ──────────────────────────────────────────────────────

const ENDPOINTS = [
	'/Device/DeviceInfo',
	'/Device/StreamTransmit',
	'/Device/StreamReceive',
	'/Device/DiscoveryConfig',
	'/Device/AudioVideoInputOutput',
	'/Device/DeviceOperations',
	// Mode + énumération (gate 2026-06-12, confirmé doc 7.3.5)
	'/Device/DeviceSpecific',      // ← Device.DeviceSpecific.DeviceMode = Receiver|Transmitter
	'/Device/DeviceCapabilities',
	'/Device',
] as const

// ── Logger console (hors runtime Companion) ───────────────────────────────────

function consoleFn(level: LogLevel, message: string): void {
	const prefix = level === 'error' ? '[ERR]' : level === 'warn' ? '[WRN]' : '[INF]'
	console.log(`${prefix} ${message}`)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convertit un chemin d'endpoint en nom de fichier sûr.
 *  Ex. : /Device/StreamTransmit → Device_StreamTransmit.json
 */
function endpointToFilename(endpoint: string): string {
	return endpoint.replace(/^\//, '').replace(/\//g, '_') + '.json'
}

/** Crée récursivement le dossier de sortie s'il n'existe pas. */
function ensureDir(dirPath: string): void {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true })
	}
}

// ── Point d'entrée ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	// Répertoire de sortie — chemin relatif à la racine du repo
	const outDir = NVX_OUTDIR
		? path.resolve(process.cwd(), NVX_OUTDIR)
		: path.resolve(
			new URL('.', import.meta.url).pathname,
			`../docs/hardware-validation/raw/${NVX_HOST}`,
		)
	ensureDir(outDir)

	const config: ModuleConfig = {
		host: NVX_HOST,
		port: NVX_PORT,
		username: NVX_USER,
		pollInterval: 2000,
		ignoreSelfSignedCert: true,
		verbose: NVX_VERBOSE,
	}

	const secrets: ModuleSecrets = {
		password: NVX_PASS,
	}

	const rootLogger = new ModuleLogger(consoleFn, '[capture-nvx]', NVX_VERBOSE)
	const authLogger = rootLogger.child('[AUTH]')
	const httpLogger = rootLogger.child('[HTTP]')

	const client = new NvxApiClient(config, secrets, authLogger, httpLogger)

	// ── Authentification ── AUCUN RETRY (risque de lockout NVX) ──────────────
	console.log(`\n[capture-nvx] Connexion à https://${NVX_HOST}:${NVX_PORT} (user: ${NVX_USER})`)
	try {
		await client.login()
		console.log('[capture-nvx] Authentification OK')
	} catch (err) {
		if (err instanceof NvxAuthError) {
			console.error(`[capture-nvx] ECHEC AUTH : ${err.message}`)
			console.error('[capture-nvx] Aucun retry — le compte NVX peut se verrouiller après plusieurs échecs.')
			console.error('[capture-nvx] Vérifiez NVX_USER / NVX_PASS et réessayez manuellement.')
		} else {
			console.error(`[capture-nvx] ERREUR RÉSEAU lors du login : ${(err as Error).message}`)
		}
		process.exit(1)
	}

	// ── Construction de la liste d'endpoints ──────────────────────────────────
	// Mode EXHAUSTIF (NVX_ALL) : énumère TOUS les sous-systèmes depuis la racine
	// /Device (varie selon le modèle) ; sinon liste fixe ENDPOINTS.
	let endpoints: string[] = [...ENDPOINTS]
	if (NVX_ALL) {
		const root = await client.get<{ Device?: Record<string, unknown> }>('/Device')
		const subs = Object.keys(root.Device ?? {})
		endpoints = ['/Device', ...subs.map((s) => `/Device/${s}`)]
		console.log(`[capture-nvx] Mode EXHAUSTIF — ${subs.length} sous-systèmes énumérés depuis /Device`)
	}

	// ── Capture des endpoints ─────────────────────────────────────────────────
	console.log(`\n[capture-nvx] Capture de ${endpoints.length} endpoints vers : ${outDir}\n`)

	const successes: string[] = []
	const failures: { endpoint: string; reason: string }[] = []

	for (const endpoint of endpoints) {
		try {
			const data = await client.get<unknown>(endpoint)
			const filename = endpointToFilename(endpoint)
			const filePath = path.join(outDir, filename)
			fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
			console.log(`  OK  ${endpoint} → ${filename}`)
			successes.push(endpoint)
		} catch (err) {
			const reason = (err as Error).message
			console.error(`  ERR ${endpoint} — ${reason}`)
			failures.push({ endpoint, reason })
		}
	}

	// ── Résumé ────────────────────────────────────────────────────────────────
	const total = endpoints.length
	const ok = successes.length
	console.log(`\n[capture-nvx] Résumé : ${ok}/${total} capturés`)
	if (failures.length > 0) {
		console.log('[capture-nvx] Endpoints en échec :')
		for (const { endpoint, reason } of failures) {
			console.log(`  - ${endpoint} : ${reason}`)
		}
		console.log('\n[capture-nvx] Ces endpoints sont peut-être absents sur ce firmware.')
		console.log('[capture-nvx] Les fichiers capturés restent valides.')
	}

	// Exit 0 si le login a réussi, même avec des endpoints partiels
	// (on veut conserver ce qui a été capturé)
	process.exit(0)
}

main().catch((err: unknown) => {
	console.error('[capture-nvx] Erreur fatale inattendue :', (err as Error).message)
	process.exit(1)
})
