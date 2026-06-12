• Session 7 (2026-06-12) : GATE hardware FAIT ✅ + mergé sur develop. 3 NVX réels capturés exhaustivement (360 Rx/Tx + E30 Tx, fw 7.1.5259.00090), commit 0788ba6 → merge f260d12 (poussé origin)
• Roadmap : GATE capture → v0.2 Encoder → v0.3 Decoder → v0.4 Audio/Vidéo → v0.5 Device-Ops → v1.0 (spec 2026-06-11 sur develop)
• Tranché empiriquement : mode=DeviceSpecific.DeviceMode ; le MODÈLE (pas le mode) change le JSON ; sentinelle "UNSUPPORTED PROPERTY" ; contrat écriture POST testé (SetPartial, StatusId 0/1, tableaux par position, live vs reboot). Réf : docs/hardware-validation.md + mémoire api-findings
• Branches : develop = socle 0.x avec gate+fixtures (worktree principal) ; feature/v0.2-encoder créée depuis develop dans le worktree Docker (.claude/worktrees/log) = dev v0.2 ; feature/capture-tooling conservée+poussée origin ; coquille feature/v0.2 supprimée

▶ NEXT : spec v0.2 Encoder sur JSON vérifié → 1er commit = généraliser poll() (cf. mémoire architecture-v0.2-foundations) → fixtures (depuis docs/hardware-validation/raw/) + code, DANS le worktree Docker
▶ FUTUR créneau labo : UAT v0.2 fonctionnel (set_stream_mode reboot, enable/disable_stream) — non testable hors device
▶ Décision : capture-tooling = outillage/docs/fixtures, hors gate UAT module → mergé develop. Le feedback-delivery-gate reste pour les versions module (v0.2+)
▶ Backlog inchangé : toggle HTTP/HTTPS ; re-login session expirée à valider en réel ; back-merge develop→main à v1.0
