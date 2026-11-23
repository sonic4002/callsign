# Art image: ComfyUI, PyTorch with CUDA, and the background-removal tools, all installed
# here at build time. Model weights are not in the image: `make art-models` downloads them
# once into the callsign-art-models volume. Generation then runs with the network off.
FROM python:3.12-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch torchvision torchaudio
ARG COMFYUI_VERSION=v0.46.2
RUN git clone --depth 1 --branch ${COMFYUI_VERSION} https://github.com/Comfy-Org/ComfyUI /comfy \
 && pip install --no-cache-dir -r /comfy/requirements.txt
RUN pip install --no-cache-dir "rembg[cpu]"
COPY extra_model_paths.yaml /comfy/extra_model_paths.yaml
# The container runs as the host user, so everything it writes to is opened up here.
RUN mkdir -p /models /work && chmod -R a+rwX /comfy /models /work
ENV HOME=/tmp \
    U2NET_HOME=/models/rembg \
    HF_HUB_OFFLINE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /src
