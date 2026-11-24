# Speech image: the text-to-speech service that gives the squads their voices in testing.
# Built on the art image, which already holds Python, NumPy, SciPy and ONNX Runtime, so
# this adds one small layer. Model weights are not in the image: `make tts-models`
# downloads them once into assets/models/bluev3. The service then runs with the network off.
FROM callsign-art
RUN pip install --no-cache-dir "blue-onnx @ git+https://github.com/maxmelichov/BlueTTS@5a9d9a04df559499b9c12715ebe1780b0f7d588c" "renikud-plus[cpu]==0.5.0" \
      heb-tts-normalizer==0.2.0 hebrew-num2words==0.1.0
# polyg2p (Apache-2.0) reads English for the model. Its wheel ships in the model bundle.
ARG BUNDLE=https://huggingface.co/notmax123/BlueV3-onnx/resolve/8410bbfe508a9b84a967324ecf3caf5f655326c9
RUN curl -fsSL -o /tmp/polyg2p-0.1.0-cp39-abi3-manylinux_2_34_x86_64.whl \
      "$BUNDLE/frontend/polyg2p-0.1.0-cp39-abi3-manylinux_2_34_x86_64.whl" \
 && echo "c32261120e83ed4d84cef433ae8bbb4cdab40e6e835eeea6483a0423c5193e37  /tmp/polyg2p-0.1.0-cp39-abi3-manylinux_2_34_x86_64.whl" | sha256sum -c - \
 && pip install --no-cache-dir /tmp/polyg2p-0.1.0-cp39-abi3-manylinux_2_34_x86_64.whl \
 && rm /tmp/*.whl
ENV HOME=/tmp \
    HF_HUB_OFFLINE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /src
