import sharp from 'sharp';
import { execFile } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import util from 'util';

const execFileAsync = util.promisify(execFile);

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

export async function processVideoTo4x5(buffer: Buffer): Promise<Buffer> {
  const tempId = uuidv4();
  const inputPath = path.join(os.tmpdir(), `${tempId}_input.mp4`);
  const outputPath = path.join(os.tmpdir(), `${tempId}_output.mp4`);

  try {
    await fs.writeFile(inputPath, buffer);
    
    // Scale and pad to 1080x1350 with black background
    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-vf', 'scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=black',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-c:a', 'copy',
      '-y', // overwrite output if exists
      outputPath
    ]);

    const outputBuffer = await fs.readFile(outputPath);
    return outputBuffer;
  } finally {
    try { await fs.unlink(inputPath); } catch (e) {}
    try { await fs.unlink(outputPath); } catch (e) {}
  }
}
