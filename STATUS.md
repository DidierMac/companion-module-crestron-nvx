• Session 7 (2026-06-12) : GATE hardware FAIT ✅ — 3 NVX réels capturés exhaustivement (360 Rx/Tx + E30 Tx, fw 7.1.5259.00090, tous sous-systèmes dans raw/<ip>/)
• Roadmap : GATE capture → v0.2 Encoder → v0.3 Decoder → v0.4 Audio/Vidéo → v0.5 Device-Ops → v1.0 (spec 2026-06-11 sur develop)
• Tranché empiriquement : mode=DeviceSpecific.DeviceMode ; le MODÈLE (pas le mode) change le JSON ; sentinelle "UNSUPPORTED PROPERTY" ; contrat écriture POST testé (SetPartial, StatusId 0/1, tableaux par position, live vs reboot). Cf. mémoire api-findings
• REX : UAT via UI Companion lent/fragile → pivot harness scriptable déterministe (rex-uat-scriptable). Outillage : capture-nvx.ts +NVX_OUTDIR/+NVX_ALL, nouveau probe-post.ts

▶ EN COURS : agent réécrit docs/hardware-validation.md (3 devices) ; puis COMMIT du gate sur feature/capture-tooling
▶ NEXT : spec v0.2 Encoder sur JSON vérifié → 1er commit = généraliser poll() (cf. architecture-v0.2-foundations) → fixtures + code
▶ FUTUR créneau labo : UAT v0.2 fonctionnel (set_stream_mode reboot, enable/disable_stream) — non testable hors device
▶ À nettoyer : anciens raw/Device_*.json à plat (périmés, exclus du commit) ; /tmp/companion-db-inspect.sqlite (rm interdit au LLM)
▶ Backlog inchangé : merge feature/capture-tooling après validation ; supprimer coquille feature/v0.2 ; toggle HTTP/HTTPS ; back-merge develop→main à v1.0
