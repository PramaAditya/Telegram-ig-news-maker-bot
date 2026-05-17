import sharp from 'sharp';

export async function processImageTo4x5(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize({
      width: 1080,
      height: 1350, // 4:5 aspect ratio
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 1 } // Black background for padding
    })
    .toFormat('jpeg', { quality: 90 })
    .toBuffer();
}
