// One WebSocket to the game server. Agents reach the match only through this: frames
// come in, tool calls go out and resolve with the server's answer.

export class Link {
  #ws;
  #pending = new Map();
  #nextId = 1;

  constructor(url, onFrame, onClose = () => {}) {
    this.url = url;
    this.onFrame = onFrame;
    this.onClose = onClose;
  }

  // open resolves once the server has greeted this connection.
  open() {
    return new Promise((resolve, reject) => {
      let greeted = false;
      this.#ws = new WebSocket(this.url);
      this.#ws.addEventListener("message", (ev) => {
        const frame = JSON.parse(ev.data);
        if (frame.type === "result") {
          const waiting = this.#pending.get(frame.id);
          this.#pending.delete(frame.id);
          if (frame.ok) waiting?.resolve(frame.data);
          else waiting?.reject(new Error(frame.error));
          return;
        }
        if (frame.type === "hello" && !greeted) {
          greeted = true;
          resolve(frame);
        }
        this.onFrame(frame);
      });
      this.#ws.addEventListener("close", (ev) => {
        for (const waiting of this.#pending.values()) waiting.reject(new Error("connection closed"));
        this.#pending.clear();
        if (greeted) this.onClose();
        else reject(new Error(ev.reason || `cannot join ${this.url}`));
      });
      this.#ws.addEventListener("error", () => {}); // the close event carries the outcome
    });
  }

  tool(name, args = {}) {
    return new Promise((resolve, reject) => {
      if (this.#ws?.readyState !== WebSocket.OPEN) return reject(new Error("connection closed"));
      const id = this.#nextId++;
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ type: "tool", id, name, args }));
    });
  }

  send(frame) {
    this.#ws.send(JSON.stringify(frame));
  }

  close() {
    this.#ws?.close();
  }
}
