---
name: fix1-rx-3states-fix2-startstop
description: FIX 1 (feedback réception décodeur à 3 états sur CodecReady) + FIX 2 (enable/disable écrivent {Start,Stop} ensemble), issus du diagnostic labo 2026-06-16
---

## Contexte

Run labo 2026-06-16 (device `.9` + source `.11`). Deux comportements à corriger, diagnostic empirique
confirmé (voir `lab-run-2026-06-16.md`, fixture RAW commitée `2026-06-16-rx-with-flux`) :

- **FIX 1** — le feedback `rx_receiving` se base sur `Status`, qui est un faux signal : casse incohérente
  (`"Stream Stopped"`/`"Stream stopped"`/`"Stream started"`) ET « armé » ≠ « décode » (4K négocié observé
  avec `CodecReady:false`, 0 paquet — cause : chiffrement, **ou source sans vidéo, ou source idle**). Le vrai
  signal de décodage = `CodecReady === true`. Didier demande **3 états visuels** : éteint / négocie-sans-décoder
  (ambre) / décode (vert).
- **FIX 2** — `{Start:true}` seul peut rester bloqué si `Stop:true` est latché côté device ;
  `{Start:true, Stop:false}` démarre proprement (confirmé labo). Défensif, applicable aux 2 panneaux.

Outcome attendu : feedback de réception fiable et diagnostique (3 états), enable/disable robustes au latch,
suite de tests verte, UAT fake vert. Merge develop = HORS scope (gate UAT réel ultérieur, [[feedback-delivery-gate]]).

## Décisions architecturales clés

1. **`rx_receiving` (vert) = `rx_codec_ready === true`** seul. Ne dépend plus jamais de `Status` (casse écartée).
2. **3 états via 2 feedbacks booléens mutuellement exclusifs** (idiome Companion N-1 feedbacks ; éteint = aucun actif) :
   - `rx_receiving` (vert `combineRgb(0,170,0)`) : `rx_codec_ready === true`
   - `rx_negotiating` (orange vif `combineRgb(255,140,0)`, NOUVEAU) : `rx_armed === true && rx_codec_ready !== true`
   - Exclusion garantie par construction (disjoints sur `rx_codec_ready`) → jamais les deux actifs.
3. **`rx_armed = HorizontalResolution > 0 || VerticalResolution > 0`** (résolution peuplée dès la négociation
   RTSP/SDP, signal numérique propre). Conséquence assumée : multicast non routé (résolution 0) → ambre éteint.
4. **Blink non supporté par le SDK** (vérifié : `CompanionButtonStyleProps` n'a que text/color/bgcolor/...).
   → état intermédiaire = couleur, pas clignotement.
5. **Description du feedback ambre neutre** : « negotiated but not decoding » (chiffrement / pas de vidéo / source idle),
   pas « encrypted source » uniquement.
6. **FIX 2 = double flag** : `enable` → `{Start:true, Stop:false}` ; `disable` → `{Stop:true, Start:false}`, sur encodeur ET décodeur.
7. **Fake** : Start → décode (CodecReady:true + résolution + paquets sur Start uniquement) ; Stop → reset.
   L'état ambre n'est PAS simulé par le fake (pas de flag env) → couvert par unit test sur fixture réelle.
8. **DEC-DISABLE** (UAT) durci en `s.CodecReady === false`.

## Carte d'implémentation

### Temps A — FIX 2 encodeur (branche `feature/v0.2.1`)
- `src/panels/encoder.ts` : `enc_enable_stream` → `post({Start:true, Stop:false})` ; `enc_disable_stream` → `post({Stop:true, Start:false})`.
- `src/panels/encoder.test.ts` : assertions body POST mises à jour.
- Commit : `fix(encoder): write both Start/Stop flags on enable/disable (avoid latched Stop)`.

### Temps git (Team Lead) — re-rebase `feature/v0.3-decoder` sur `feature/v0.2.1` à jour
- AVANT : créer `backup/v0.3-pre-fix2`.
- ⚠️ Conflit possible sur `encoder.ts:76/83` (réalignement v0.3 `d2f07a3` a touché l'encodeur) → garder version FIX 2.
- APRÈS : `npm run build && npm test` verts (136) sur v0.3 avant Temps B.

### Temps B — FIX 2 décodeur + FIX 1 (branche `feature/v0.3-decoder`)
- **FIX 2 décodeur** — `src/panels/decoder.ts` : `dec_enable_stream` → `{Start:true, Stop:false}` ; `dec_disable_stream` → `{Stop:true, Start:false}`. (commit séparé)
- **FIX 1** — `src/panels/decoder.ts` :
  - variables : `rx_codec_ready` (`s?.CodecReady === true`), `rx_video_packets` (`num(s?.NumVideoPacketsRcvd)`), `rx_armed` (`num(s?.HorizontalResolution) > 0 || num(s?.VerticalResolution) > 0`).
  - feedback `rx_receiving` → `() => state().rx_codec_ready === true` (vert).
  - feedback `rx_negotiating` (nouveau) → `() => state().rx_armed === true && state().rx_codec_ready !== true` (orange vif).
  - constante `AMBER = combineRgb(255, 140, 0)`.
  - preset `dec_start_rx` (decoder.ts:192) : empiler `rx_negotiating` (ambre) + `rx_receiving` (vert).
- `src/panels/decoder.test.ts` : 3 états (repos→aucun, armé-non-décodé→ambre, décode→vert), exclusion mutuelle, fixture réelle `2026-06-16-rx-with-flux`, preset à 2 feedbacks.
- `scripts/uat/fake-device/server.ts` (`applyReceiveSetPartial`) : Start → CodecReady:true + résolution 3840/2160/30 + incrément paquets ; Stop → reset.
- `scripts/uat/fake-device/receive.test.ts` : assertions CodecReady/paquets sur Start/Stop.
- `scripts/uat/journey/steps-lab.ts` : DEC-ENABLE vise CodecReady/paquets ; DEC-DISABLE durci `CodecReady === false`.
- Commits séparés : un FIX 2 décodeur, un FIX 1.

## Grille de complexité

| Vague | Tâche | Complexité | test-writer | coder | qa | code-reviewer |
|-------|-------|-----------|-------------|-------|-----|---------------|
| 1 | FIX 2 encodeur | Faible | haiku | haiku | haiku | sonnet |
| 2 | FIX 2 décodeur | Faible | haiku | haiku | haiku | sonnet |
| 2 | FIX 1 decoder.ts (vars + 2 feedbacks 3-états + preset) | Moyenne→Haute | **opus** | sonnet | sonnet | sonnet |
| 2 | FIX 1 fake + receive.test.ts | Moyenne | sonnet | sonnet | sonnet | sonnet |
| 2 | FIX 1 steps-lab.ts | Moyenne | sonnet | sonnet | sonnet | sonnet |

Agents persistants sync dimensionnés au max rencontré : **test-writer opus**, **coder sonnet**, **qa sonnet**, **code-reviewer sonnet**.

## Questions ouvertes / remontées

- ⚠️ **ARCHITECTURE.md absent du repo** (pilier doc manquant) — backlog (décidé), à traiter en session dédiée.
- RAW labo `raw/2026-06-16-192.168.2.9/` + `-rx-with-flux/` sont commités (✅, commit afe7ea0) ; `-rx-receiving/` polluée à supprimer (backlog).
- FIX 4 chiffrement / trust cert = backlog v0.4+ (bloque le décodage réel au labo, hors scope).

## Vérification

- `npm run build` clean + `npm test` (≥136, + nouveaux tests 3-états & double-flag) verts, sur v0.2.1 (Temps A) puis v0.3 (Temps B).
- `npm run uat:journey` contre le fake Receiver (`FAKE_NVX_PASS=test123 FAKE_NVX_RAW=docs/hardware-validation/raw/192.168.2.9`) vert → DEC-* avec nouveau `rx_receiving`.
- Critère de succès : feedback vert UNIQUEMENT si CodecReady ; ambre si négocié-non-décodé (prouvé sur fixture réelle) ; enable/disable POSTent les 2 flags.
- Labo réel = gate ultérieur séparé (non couvert cette session).
