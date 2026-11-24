// Token ids to text for the two recognisers. Only decoding is needed in the browser.
//
// "bytes": byte-level BPE (GPT-2 style), used by the Hebrew model. Ported from the Ozen
// web app (https://github.com/itayinbarr/ozen), MIT, Copyright (c) 2026 Itay Inbar.
// "pieces": SentencePiece-style BPE with a byte fallback, used by the English model.

// Inverse of GPT-2's bytes_to_unicode: code point → byte.
function byteDecoder() {
  const bs = [];
  for (let b = 0x21; b <= 0x7e; b++) bs.push(b);
  for (let b = 0xa1; b <= 0xac; b++) bs.push(b);
  for (let b = 0xae; b <= 0xff; b++) bs.push(b);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n++);
    }
  }
  return new Map(bs.map((b, i) => [cs[i], b]));
}

export class Tokenizer {
  // json is the parsed tokenizer.json; kind is "bytes" or "pieces".
  constructor(json, kind) {
    const text = new TextEncoder();
    const table = kind === "bytes" ? byteDecoder() : null;
    this.tokens = [];
    for (const [tok, id] of Object.entries(json.model.vocab)) {
      let bytes;
      const hex = !table && /^<0x([0-9A-Fa-f]{2})>$/.exec(tok);
      if (table) bytes = Uint8Array.from([...tok].map((ch) => table.get(ch.codePointAt(0))).filter((b) => b !== undefined));
      else if (hex) bytes = Uint8Array.of(parseInt(hex[1], 16));
      else bytes = text.encode(tok.replaceAll("▁", " "));
      this.tokens[id] = bytes;
    }
    this.special = new Set((json.added_tokens ?? []).map((a) => a.id));
  }

  decode(ids) {
    const parts = ids.filter((id) => !this.special.has(id) && this.tokens[id]).map((id) => this.tokens[id]);
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) {
      all.set(p, off);
      off += p.length;
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(all).split(/\s+/).filter(Boolean).join(" ");
  }
}
