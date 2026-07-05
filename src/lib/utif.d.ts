// @ts-ignore Ñ utif has no bundled types
declare module 'utif' {
  interface IFD {
    width: number;
    height: number;
    data: Uint8Array; // raw decoded pixel data (set after decodeImage)
    [key: string]: unknown;
  }
  function decode(buffer: ArrayBuffer): IFD[];
  function decodeImage(buffer: ArrayBuffer, ifd: IFD): void;
  function toRGBA8(ifd: IFD): Uint8Array;
}