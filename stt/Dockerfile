# Listening image: the speech-recognition service (stt/server.py) that transcribes the
# player's radio calls. Whisper on CTranslate2 (faster-whisper), with the two CUDA
# libraries it needs from pip (2.1 GB of the image's 4.4 GB), so the image stands alone. Model weights are
# not in the image: `make stt-models` downloads them once into assets/models/whisper-*.
# The service then runs with the network off.
FROM python:3.12-slim
RUN pip install --no-cache-dir faster-whisper==1.2.1 ctranslate2==4.9.1 \
      nvidia-cublas-cu12==12.9.3.13 nvidia-cudnn-cu12==9.28.1.4 aiohttp==3.14.5
# CTranslate2 looks its CUDA libraries up by name; they live in the pip packages.
ENV LD_LIBRARY_PATH=/usr/local/lib/python3.12/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.12/site-packages/nvidia/cudnn/lib \
    HOME=/tmp \
    HF_HUB_OFFLINE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /src
