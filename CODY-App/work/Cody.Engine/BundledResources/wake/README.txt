C.O.D.Y. local wake detector

Runtime: sherpa-onnx 1.13.5 (Apache-2.0)
Source: https://github.com/k2-fsa/sherpa-onnx
License: https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE
Model: sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20
Model and keyword documentation: https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html

The detector uses the CPU locally. Standby microphone audio is retained only
in a short memory buffer. A confirmed wake hands buffered request audio to
C.O.D.Y.'s existing voice recognition. Turning hands-free off stops capture.

Reproduce dependencies with tools/prepare-wake-runtime.ps1 before rebuilding.
The script verifies pinned SHA-256 hashes for downloaded runtime/model archives.

Speech activity: Silero VAD, run locally during hands-free request capture.
Source: https://github.com/snakers4/silero-vad
Model: https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx
