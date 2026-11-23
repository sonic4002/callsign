#!/bin/sh
# Downloads the model weights into /models (the callsign-art-models volume). Run once,
# with the network on: make art-models. Re-running resumes or skips finished files.
#
#   FLUX.2 [klein] 4B, distilled   Apache-2.0   black-forest-labs/FLUX.2-klein-4B
#   Qwen3 4B text encoder (fp4)    Apache-2.0   repackaged by Comfy-Org
#   FLUX.2 VAE                     Apache-2.0   repackaged by Comfy-Org
#   BiRefNet (background removal)  MIT          ZhengPeng7/BiRefNet, ONNX build from rembg
set -eu
base=https://huggingface.co/Comfy-Org/Flux-2-Klein-4B/resolve/main/split_files
get() {
  mkdir -p "/models/$1"
  if [ -f "/models/$1/$2.done" ]; then echo "have $2"; return; fi
  echo "downloading $2"
  curl -fL --retry 5 -C - -o "/models/$1/$2" "$3"
  touch "/models/$1/$2.done"
}
get diffusion_models flux-2-klein-4b.safetensors          "$base/diffusion_models/flux-2-klein-4b.safetensors"
get text_encoders    qwen_3_4b_fp4_flux2.safetensors      "$base/text_encoders/qwen_3_4b_fp4_flux2.safetensors"
get vae              flux2-vae.safetensors                "$base/vae/flux2-vae.safetensors"
get rembg            birefnet-general.onnx                "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx"
du -sh /models
