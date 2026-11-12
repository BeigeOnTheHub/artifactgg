export type Hex = string & { readonly __brand: 'Hex' };

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isHex(s: string): s is Hex {
  return HEX_RE.test(s);
}

export function assertHex(s: string): asserts s is Hex {
  if (!isHex(s)) throw new Error(`Invalid hex colour: ${s}`);
}

export function hex(s: string): Hex {
  assertHex(s);
  return s;
}
