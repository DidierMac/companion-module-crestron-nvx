• Session 2026-06-14 (très dense) : DEUX chantiers. (1) v0.2 Encoder CODE COMPLET sur feature/v0.2-encoder (3 vagues, 44 tests, revues GO) → attend UAT labo. (2) Harness UAT NOUVEAU sur feature/uat-harness : spec+plan+Vagues 1-2 (66 tests) + smoke live réussi.
• Roadmap : GATE capture ✅ → v0.2 Encoder (CODE FAIT, UAT à venir) → v0.3 Decoder → v0.4 Audio/Vidéo → v0.5 Device-Ops → v1.0
• v0.2 : panneau=1 sous-système+gate ; main.ts migré (scheduleReconnect intact) ; hook pretest typecheck ; checkAllFeedbacks ; upgrades.ts supprimé. Scénarios UAT v0.2 dans docs/UAT.md. ⛔ pas de merge develop sans UAT labo.
• Harness UAT : 3 tiers + fallback LLM batch. Vagues 1-2 = socle (verdict/report/redact) + Tier 0 (auth-gauntlet, encoder POST, restauration device). Runner dédié. playwright-core GLOBAL+npm link (channel:chrome). Smoke live : Companion 4.3.4 + module crestron-nvx (dev) + Chrome système vus.

▶ NEXT harness = VAGUE 3 (Tier 1 Companion, FAISABLE EN LOCAL sans device) : capturer frames Satellite KEY-STATE → companion-http.ts + satellite-client.ts + cas CAP-01/ENC-06/B1-B3 + uat/layout.json + SETUP.md. Plan = docs/superpowers/plans/2026-06-14-uat-harness.md (Tasks 9-16).
▶ NEXT v0.2 = UAT au labo (device requis, mode Transmitter). Backlog complet : docs/VALIDATION.md.
▶ Env live laissé : conteneur companion-uat (port 8000, module chargé). 2 vulns npm « high » (playwright-core) à voir à froid. package.json reformaté cosmétique non committé (laissé). scripts/uat/_browser-smoke.mjs untracked.
▶ Sources de vérité reprise : plans (57a04b3 v0.2, 2026-06-14 harness) + docs/VALIDATION.md + mémoire project-state.
