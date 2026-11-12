import { initSync } from "./wasm/mogdoppixes_core";
import { coreBinary } from "./wasm-binary";
export function initializeCore(): void {
  const binary = Uint8Array.from(atob(coreBinary), (character) =>
    character.charCodeAt(0),
  );
  initSync({ module: binary });
}

export function bytes(pixels: Uint8ClampedArray): Uint8Array {
  return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
}
