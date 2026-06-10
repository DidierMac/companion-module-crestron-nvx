• Session 5 (2026-06-10) : v0.1.0 LIVRÉE — merge feature/log → develop, tag v0.1.0, push + release GitHub
• UAT réussi sur appareil réel DM-NVX-360 (fw 7.1.5259) : auth + heartbeat + variables + logging OK
• 5 bugs auth corrigés : secrets-channel (A), 401/403 arrêt franc (B), init non bloquant (C), timers (D), succès HTTP 200 (E)

▶ Prochaine étape : v0.2 — actions (routing/audio/stream) + feedbacks + variables complètes (design spec 2026-05-18 §14)
▶ Backlog : toggle HTTP/HTTPS ; nettoyage worktree/branche feature/log ; back-merge develop→main si voulu
▶ Note : docker compose depuis .claude/worktrees/log (docker-compose.yml absent sur develop) ; appareil sur 192.168.2.9
