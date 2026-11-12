declare module 'gifenc' {
  export function quantize(data: Uint8ClampedArray, maximum: number, options?: Record<string, unknown>): number[][];
  export function applyPalette(data: Uint8ClampedArray, palette: number[][], format?: string): Uint8Array;
  export function GIFEncoder(): { writeFrame(data: Uint8Array, width: number, height: number, options: Record<string, unknown>): void; finish(): void; bytes(): Uint8Array };
}
