# UAT run — journey

Started: 2026-06-16T23:26:38.616Z

Totals — PASS 16 · FAIL 5 · AMBIGUOUS 0 · HUMAN 0 · SKIP 4

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

### [!] CAP · expected a Transmitter device for the encoder journey (tier 1)
- expected: `"Transmitter"`
- observed: `"Receiver"`

### [!] ENC-VARS · variable/device mismatch (tier 1)
- observed: `{"tx_stream_name":{"companion":"","device":"DM-NVX-360-00107FF7D99A"},"tx_enabled":{"companion":"","device":"false"}}`

### [!] ENC-FEEDBACKS · feedback source mismatch (tier 1)
- expected: `"false"`
- observed: `""`

### [-] ENC-NAME · set stream name → device (button unmapped) (tier 1)
- note: button 'set_stream_name' not in layout — see SETUP

### [-] ENC-MULTICAST · set multicast address → device (button unmapped) (tier 1)
- note: button 'set_multicast_address' not in layout — see SETUP

### [-] ENC-ENABLE · start stream → device (button unmapped) (tier 1)
- note: button 'enc_enable_stream' not in layout — see SETUP

### [-] ENC-DISABLE · stop stream → device (button unmapped) (tier 1)
- note: button 'enc_disable_stream' not in layout — see SETUP

### [x] DEC-CAP · decoder panel active (role=Receiver) (tier 1)
- note: device_role=Receiver

### [x] BASELINE-RX · decoder baseline captured (tier 1)
- note: stored for TEARDOWN-RX restore

### [x] DEC-VARS · companion decoder variables == device (tier 1)
- note: 4/4 match

### [!] DEC-SOURCE-URL · set source URL (ByReceiver) → device (tier 1)
- expected: `{"SessionInitiation":"ByReceiver","StreamLocation":"rtsp://192.168.2.10:554/live.sdp"}`
- observed: `{"AudioChannels":0,"AudioFormat":"NoAudio","AudioMode":"Manual","Bitrate":0,"Buffer":1000,"CodecReady":false,"ElapsedSeconds":0,"FramesPerSecond":0,"HdcpTransmitterMode":"Always","HorizontalResolution":0,"InitiatorAddress":"","IsAutomaticInitiationEnabled":true,"IsPasswordProtectionEnabled":"***","IsStatisticsEnabled":false,"MulticastAddress":"","NumAudioPacketsDropped":0,"NumAudioPacketsRcvd":0,"NumVideoPacketsDropped":0,"NumVideoPacketsRcvd":0,"Password":"***","Pause":false,"Processing":false,"RtpAudioPort":49172,"RtpVideoPort":49170,"RtspPort":554,"SessionInitiation":"ByReceiver","Start":false,"Status":"Stream Stopped","Stop":false,"StreamLocation":"","StreamProfile":"High","StreamTrustedCertifyingAuthorities":{"Certificates":[{"Name":"SecureTrust CA","Trusted":true,"Uid":"0CF08E5C0816A5AD427FF0EB271859D0"}],"DontTrustCertifyingAuthority":{"Name":"Certificate Name"},"TrustCertifyingAuthority":{"Name":"Certificate Name"}},"StreamType":"Primary","TcpMode":"Auto","TransportMode":"MPEG2TSRTP","TsPort":4570,"Username":"","VerticalResolution":0,"VideoFormat":"Pixel","Volume":0}`

### [x] DEC-SOURCE-MCAST · set source multicast → device (tier 1)
- note: device changed as expected

### [x] DEC-CONNECT · connect to discovered stream by name → device (tier 1)
- note: device changed as expected

### [x] DEC-NEGOTIATING · start reception (negotiating scenario) → CodecReady false, resolution populated (tier 1)
- note: device changed as expected

### [!] DEC-DECODING · start reception (decoding scenario) → CodecReady true (tier 1)
- expected: `{"CodecReady":true}`
- observed: `{"AudioChannels":0,"AudioFormat":"NoAudio","AudioMode":"Manual","Bitrate":0,"Buffer":1000,"CodecReady":false,"ElapsedSeconds":0,"FramesPerSecond":30,"HdcpTransmitterMode":"Always","HorizontalResolution":3840,"InitiatorAddress":"","IsAutomaticInitiationEnabled":true,"IsPasswordProtectionEnabled":"***","IsStatisticsEnabled":false,"MulticastAddress":"239.1.1.4","NumAudioPacketsDropped":0,"NumAudioPacketsRcvd":0,"NumVideoPacketsDropped":0,"NumVideoPacketsRcvd":0,"Password":"***","Pause":false,"Processing":false,"RtpAudioPort":49172,"RtpVideoPort":49170,"RtspPort":554,"SessionInitiation":"Multicast via RTSP","Start":false,"Status":"Stream started","Stop":false,"StreamLocation":"","StreamProfile":"High","StreamTrustedCertifyingAuthorities":{"Certificates":[{"Name":"SecureTrust CA","Trusted":true,"Uid":"0CF08E5C0816A5AD427FF0EB271859D0"}],"DontTrustCertifyingAuthority":{"Name":"Certificate Name"},"TrustCertifyingAuthority":{"Name":"Certificate Name"}},"StreamType":"Primary","TcpMode":"Auto","TransportMode":"MPEG2TSRTP","TsPort":4570,"Username":"","VerticalResolution":2160,"VideoFormat":"Pixel","Volume":0}`

### [x] DEC-ENABLE · start reception → device (tier 1)
- note: device changed as expected

### [x] DEC-DISABLE · stop reception → device (tier 1)
- note: device changed as expected

### [x] TEARDOWN-RX · decoder restored (tier 1)
- note: StreamReceive baseline re-applied

### [x] TEARDOWN · device restored + connection disabled (tier 1)
- note: device restored; connection disabled
