# Apple trust root

AppleRootCA-G3.cer is the public DER trust root downloaded from Apple's certificate authority on 2026-09-08:
https://www.apple.com/certificateauthority/AppleRootCA-G3.cer

SHA-256: 63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179

It is a public CA certificate, not a signing credential. Production verifiers pin this bundled root and enable online revocation checks. Synthetic test roots are generated in temporary test directories; HTTP input and environment variables cannot replace this trust root. Review Apple CA changes before replacing it.
