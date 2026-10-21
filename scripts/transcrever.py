#!/usr/bin/env python3
"""Transcreve um áudio em português e imprime só o texto (saída vazia = sem fala).

Uso: python3 scripts/transcrever.py <arquivo>
Chamado pelo worker do CRM (src/server/whatsapp/audio.ts, TRANSCRIBE_CMD). Roda no venv com faster-whisper
(docs/deploy-contabo.md › Áudio). Variáveis:
  WHISPER_MODEL             modelo (padrão "small"; "medium" é melhor e mais lento)
  WHISPER_DIR               pasta do cache do modelo (padrão: cache do Hugging Face, ~/.cache/huggingface)
  WHISPER_THREADS           threads da CPU (padrão 2, para não tomar o servidor)
  TRANSCREVER_MAX_SEGUNDOS  só os N primeiros segundos (o worker manda 600)
Saídas: 0 ok · 2 uso errado · 3 faster-whisper não instalado · 1 qualquer outra falha.
"""
import os
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("uso: transcrever.py <arquivo>", file=sys.stderr)
        return 2
    try:
        from faster_whisper import WhisperModel, decode_audio
    except ImportError:
        print("faster-whisper não instalado (pip install faster-whisper)", file=sys.stderr)
        return 3

    arquivo = sys.argv[1]
    max_seg = int(os.environ.get("TRANSCREVER_MAX_SEGUNDOS") or "0")
    model = WhisperModel(
        os.environ.get("WHISPER_MODEL") or "small",
        device="cpu",
        compute_type="int8",
        cpu_threads=int(os.environ.get("WHISPER_THREADS") or "2"),
        download_root=os.environ.get("WHISPER_DIR") or None,
    )
    sr = 16000
    audio = decode_audio(arquivo, sampling_rate=sr)
    if max_seg > 0:
        audio = audio[: max_seg * sr]  # áudio longo: só o começo
    segments, _info = model.transcribe(audio, language="pt", vad_filter=True, beam_size=5)
    texto = " ".join(s.text.strip() for s in segments if s.text.strip())
    sys.stdout.write(texto.strip() + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
