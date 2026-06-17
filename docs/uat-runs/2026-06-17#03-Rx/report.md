# UAT run — journey

Started: 2026-06-17T14:51:25.167Z

Totals — PASS 7 · FAIL 5 · AMBIGUOUS 0 · HUMAN 0 · SKIP 13

### [x] INSTALL · module available (tier 1)

### [x] CFG-NOPASS · empty password → BadConfig (tier 1)
- note: status=warning + cause logged

### [x] CFG-UNREACHABLE · unreachable IP → ConnectionFailure (tier 1)
- note: status=error + cause logged

### [!] CFG-WRONGPASS · wrong password → AuthenticationFailure (tier 1)
- expected: `{"category":"warning","cause":"auth 401/403"}`
- observed: `{"status":{"category":"error","level":"Connection Failure","message":"NVX timeout: GET /userlogin.html"},"logged":false}`

### [!] CFG-GOOD · connected (oracle confirms session) (tier 1)
- expected: `{"category":"good","oracle":"readStream0 succeeds"}`
- observed: `{"category":"warning","oracleOk":true}`

### [x] BASELINE · baseline captured (tier 1)
- note: stored for TEARDOWN restore

### [-] CAP · encoder journey (device is not a Transmitter) (tier 1)
- note: device_role=

### [-] ENC-VARS · encoder vars (device is not a Transmitter) (tier 1)
- note: device_role=

### [-] ENC-FEEDBACKS · encoder feedbacks (device is not a Transmitter) (tier 1)
- note: device_role=

### [!] ENC-NAME · set stream name → device (tier 1)
- expected: `{"RtspSessionName":"UAT-STREAM"}`
- observed: `{"AudioChannels":2,"AudioFormat":"NoAudio","AudioMode":"Manual","Bitrate":750,"BitrateMode":"Fixed","Camera":{"CameraFileName":"camera","CameraHorizontalResolution":0,"CameraMulticastAddress":"","CameraResolution":"1280x720","CameraRtspPort":8554,"CameraUri":"Test.com","CameraVerticalResolution":0,"IsCameraMulticastEnabled":false,"IsCameraStreamEnabled":true},"CodecReady":false,"Dscp":32,"ElapsedSeconds":0,"EncodingResolution":"Auto","FecMode":"Off","FramesPerSecond":0,"HdcpTransmitterMode":"Always","HorizontalResolution":0,"IsAdaptiveBitrateMode":false,"IsAutomaticInitiationEnabled":true,"IsPasswordProtectionEnabled":"***","IsStatisticsEnabled":false,"MultiCastTtl":5,"MulticastAddress":"","NetworkAdapter":"","NumAudioPacketsTransmitted":0,"NumVideoPacketsDropped":0,"NumVideoPacketsTransmitted":0,"Password":"***","Pause":false,"Processing":false,"RtpAudioPort":49172,"RtpVideoPort":49170,"RtspPort":554,"RtspSessionName":"DM-NVX-360-00107FF7D99A","RtspStreamFileName":"","SessionInitiation":"Multicast via RTSP","SnapshotFileName":"","SnapshotUri":"","Start":false,"Status":"Stream Stopped","Stop":false,"StreamEncodingType":"Pixel Perfect Processing","StreamLocation":"","StreamProfile":"High","StreamSource":"","StreamType":"Primary","TransportMode":"MPEG2TSRTP","TsPort":4570,"UUID":"00000000-0000-4002-0059-e204090f0004","Username":"","VerticalResolution":0,"VideoFormat":"J2000"}`

### [!] ENC-MULTICAST · set multicast address → device (tier 1)
- expected: `{"MulticastAddress":"239.200.0.1"}`
- observed: `{"AudioChannels":2,"AudioFormat":"NoAudio","AudioMode":"Manual","Bitrate":750,"BitrateMode":"Fixed","Camera":{"CameraFileName":"camera","CameraHorizontalResolution":0,"CameraMulticastAddress":"","CameraResolution":"1280x720","CameraRtspPort":8554,"CameraUri":"Test.com","CameraVerticalResolution":0,"IsCameraMulticastEnabled":false,"IsCameraStreamEnabled":true},"CodecReady":false,"Dscp":32,"ElapsedSeconds":0,"EncodingResolution":"Auto","FecMode":"Off","FramesPerSecond":0,"HdcpTransmitterMode":"Always","HorizontalResolution":0,"IsAdaptiveBitrateMode":false,"IsAutomaticInitiationEnabled":true,"IsPasswordProtectionEnabled":"***","IsStatisticsEnabled":false,"MultiCastTtl":5,"MulticastAddress":"","NetworkAdapter":"","NumAudioPacketsTransmitted":0,"NumVideoPacketsDropped":0,"NumVideoPacketsTransmitted":0,"Password":"***","Pause":false,"Processing":false,"RtpAudioPort":49172,"RtpVideoPort":49170,"RtspPort":554,"RtspSessionName":"DM-NVX-360-00107FF7D99A","RtspStreamFileName":"","SessionInitiation":"Multicast via RTSP","SnapshotFileName":"","SnapshotUri":"","Start":false,"Status":"Stream Stopped","Stop":false,"StreamEncodingType":"Pixel Perfect Processing","StreamLocation":"","StreamProfile":"High","StreamSource":"","StreamType":"Primary","TransportMode":"MPEG2TSRTP","TsPort":4570,"UUID":"00000000-0000-4002-0059-e204090f0004","Username":"","VerticalResolution":0,"VideoFormat":"J2000"}`

### [!] ENC-ENABLE · start stream → device (tier 1)
- expected: `{"Status":"Stream started"}`
- observed: `{"AudioChannels":2,"AudioFormat":"NoAudio","AudioMode":"Manual","Bitrate":750,"BitrateMode":"Fixed","Camera":{"CameraFileName":"camera","CameraHorizontalResolution":0,"CameraMulticastAddress":"","CameraResolution":"1280x720","CameraRtspPort":8554,"CameraUri":"Test.com","CameraVerticalResolution":0,"IsCameraMulticastEnabled":false,"IsCameraStreamEnabled":true},"CodecReady":false,"Dscp":32,"ElapsedSeconds":0,"EncodingResolution":"Auto","FecMode":"Off","FramesPerSecond":0,"HdcpTransmitterMode":"Always","HorizontalResolution":0,"IsAdaptiveBitrateMode":false,"IsAutomaticInitiationEnabled":true,"IsPasswordProtectionEnabled":"***","IsStatisticsEnabled":false,"MultiCastTtl":5,"MulticastAddress":"","NetworkAdapter":"","NumAudioPacketsTransmitted":0,"NumVideoPacketsDropped":0,"NumVideoPacketsTransmitted":0,"Password":"***","Pause":false,"Processing":false,"RtpAudioPort":49172,"RtpVideoPort":49170,"RtspPort":554,"RtspSessionName":"DM-NVX-360-00107FF7D99A","RtspStreamFileName":"","SessionInitiation":"Multicast via RTSP","SnapshotFileName":"","SnapshotUri":"","Start":false,"Status":"Stream Stopped","Stop":false,"StreamEncodingType":"Pixel Perfect Processing","StreamLocation":"","StreamProfile":"High","StreamSource":"","StreamType":"Primary","TransportMode":"MPEG2TSRTP","TsPort":4570,"UUID":"00000000-0000-4002-0059-e204090f0004","Username":"","VerticalResolution":0,"VideoFormat":"J2000"}`

### [x] ENC-DISABLE · stop stream → device (tier 1)
- note: device changed as expected

### [-] DEC-CAP · decoder panel (device is not a Receiver) (tier 1)
- note: device_role=

### [-] BASELINE-RX · baseline-rx (device is not a Receiver) (tier 1)
- note: device_role=

### [-] DEC-VARS · decoder variables (device is not a Receiver) (tier 1)
- note: device_role=

### [-] DEC-SOURCE-URL · set source URL (ByReceiver) → device (button unmapped) (tier 1)
- note: button 'set_source_url' not in layout — see SETUP

### [-] DEC-SOURCE-MCAST · set source multicast → device (button unmapped) (tier 1)
- note: button 'set_source_multicast' not in layout — see SETUP

### [-] DEC-CONNECT · connect to discovered stream by name → device (button unmapped) (tier 1)
- note: button 'connect_to_stream' not in layout — see SETUP

### [-] DEC-NEGOTIATING · start reception (negotiating scenario) → CodecReady false, resolution populated (button unmapped) (tier 1)
- note: button 'dec_enable_stream' not in layout — see SETUP

### [-] DEC-DECODING · start reception (decoding scenario) → CodecReady true (button unmapped) (tier 1)
- note: button 'dec_enable_stream' not in layout — see SETUP

### [-] DEC-ENABLE · start reception → device (button unmapped) (tier 1)
- note: button 'dec_enable_stream' not in layout — see SETUP

### [-] DEC-DISABLE · stop reception → device (button unmapped) (tier 1)
- note: button 'dec_disable_stream' not in layout — see SETUP

### [x] TEARDOWN-RX · decoder restored (tier 1)
- note: StreamReceive baseline re-applied

### [x] TEARDOWN · device restored + connection disabled (tier 1)
- note: device restored; connection disabled
