// An audio worklet that hands the microphone's samples to the page while the talk button
// is held (voice.js), a few hundredths of a second at a time, so a call can be recognised
// while it is still being said.
//
//   in:  "on"      start handing over samples
//        "flush"   hand over what is left, answer "flushed", and stop
//   out: Float32Array blocks at the audio context's own rate; "flushed"

class Tap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.blocks = [];
    this.held = 0;
    this.port.onmessage = ({ data }) => {
      if (data === "on") this.on = true;
      else if (data === "flush") {
        this.send();
        this.on = false;
        this.port.postMessage("flushed");
      }
    };
  }

  send() {
    if (!this.held) return;
    const all = new Float32Array(this.held);
    let at = 0;
    for (const b of this.blocks) {
      all.set(b, at);
      at += b.length;
    }
    this.blocks = [];
    this.held = 0;
    this.port.postMessage(all, [all.buffer]);
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (this.on && channel?.length) {
      this.blocks.push(channel.slice());
      this.held += channel.length;
      if (this.held >= 2048) this.send();
    }
    return true;
  }
}

registerProcessor("callsign-tap", Tap);
