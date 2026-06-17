# UAT run — journey

Started: 2026-06-14T22:08:52.213Z

Totals — PASS 10 · FAIL 0 · AMBIGUOUS 0 · HUMAN 0 · SKIP 4

### [x] INSTALL · module available (tier 1)

### [x] CFG-NOPASS · empty password → BadConfig (tier 1)
- note: status=warning + cause logged

### [x] CFG-UNREACHABLE · unreachable IP → ConnectionFailure (tier 1)
- note: status=error + cause logged

### [x] CFG-WRONGPASS · wrong password → AuthenticationFailure (tier 1)
- note: auth failure + logged (1 login used)

### [x] CFG-GOOD · connected (oracle confirms session) (tier 1)
- note: status good + oracle read stream

### [x] BASELINE · baseline captured (tier 1)
- note: stored for TEARDOWN restore

### [x] CAP · encoder panel active (role=Transmitter) (tier 1)
- note: device_role=Transmitter

### [x] ENC-VARS · companion variables == device (tier 1)
- note: 4/4 match

### [x] ENC-FEEDBACKS · feedback source matches device (tier 1)
- note: stream_enabled=false

### [-] ENC-NAME · set stream name → device (button unmapped) (tier 1)
- note: button 'set_stream_name' not in layout — see SETUP

### [-] ENC-MULTICAST · set multicast address → device (button unmapped) (tier 1)
- note: button 'set_multicast_address' not in layout — see SETUP

### [-] ENC-ENABLE · start stream → device (button unmapped) (tier 1)
- note: button 'enable_stream' not in layout — see SETUP

### [-] ENC-DISABLE · stop stream → device (button unmapped) (tier 1)
- note: button 'disable_stream' not in layout — see SETUP

### [x] TEARDOWN · device restored + connection disabled (tier 1)
- note: device restored; connection disabled
