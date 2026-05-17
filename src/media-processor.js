import sharp from 'sharp';
import { execFile } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import util from 'util';
const execFileAsync = util.promisify(execFile);
export async function processImageTo4x5(buffer) {
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
export async function mergeImageAndVideo(imageBuffer, videoBuffer) {
    const tempId = uuidv4();
    const imagePath = path.join(os.tmpdir(), `${tempId}_image.jpg`);
    const videoPath = path.join(os.tmpdir(), `${tempId}_video.mp4`);
    const outputPath = path.join(os.tmpdir(), `${tempId}_output.mp4`);
    try {
        await fs.writeFile(imagePath, imageBuffer);
        await fs.writeFile(videoPath, videoBuffer);
        // Check if video has audio stream
        let hasAudio = false;
        try {
            const { stdout } = await execFileAsync('ffprobe', [
                '-v', 'error',
                '-select_streams', 'a',
                '-show_entries', 'stream=codec_type',
                '-of', 'default=nw=1:nk=1',
                videoPath
            ]);
            hasAudio = stdout.trim().length > 0;
        }
        catch (e) {
            console.log('Error checking audio stream, assuming no audio');
        }
        const filterComplex = hasAudio
            ? `[0:v]scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v0];` +
                `anullsrc=channel_layout=stereo:sample_rate=44100:d=3[a0];` +
                `[1:v]scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v1];` +
                `[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a1];` +
                `[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]`
            : `[0:v]scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v0];` +
                `[1:v]scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v1];` +
                `[v0][v1]concat=n=2:v=1:a=0[outv]`;
        const args = [
            '-v', 'error',
            '-loop', '1', '-framerate', '30', '-t', '3', '-i', imagePath,
            '-i', videoPath,
            '-filter_complex', filterComplex,
            '-map', '[outv]'
        ];
        if (hasAudio) {
            args.push('-map', '[outa]');
        }
        args.push('-c:v', 'libx264', '-preset', 'fast', '-c:a', 'aac', '-vsync', '2', '-y', outputPath);
        await execFileAsync('ffmpeg', args, { maxBuffer: 10 * 1024 * 1024 });
        const outputBuffer = await fs.readFile(outputPath);
        return outputBuffer;
    }
    finally {
        try {
            await fs.unlink(imagePath);
        }
        catch (e) { }
        try {
            await fs.unlink(videoPath);
        }
        catch (e) { }
        try {
            await fs.unlink(outputPath);
        }
        catch (e) { }
    }
}
export async function extractFirstFrame(videoBuffer) {
    const tempId = uuidv4();
    const inputPath = path.join(os.tmpdir(), `${tempId}_input.mp4`);
    const outputPath = path.join(os.tmpdir(), `${tempId}_output.jpg`);
    try {
        await fs.writeFile(inputPath, videoBuffer);
        await execFileAsync('ffmpeg', [
            '-v', 'error',
            '-i', inputPath,
            '-vframes', '1',
            '-q:v', '2',
            '-y',
            outputPath
        ], { maxBuffer: 10 * 1024 * 1024 });
        const outputBuffer = await fs.readFile(outputPath);
        return outputBuffer;
    }
    finally {
        try {
            await fs.unlink(inputPath);
        }
        catch (e) { }
        try {
            await fs.unlink(outputPath);
        }
        catch (e) { }
    }
}
export async function processVideoTo4x5(buffer) {
    const tempId = uuidv4();
    const inputPath = path.join(os.tmpdir(), `${tempId}_input.mp4`);
    const outputPath = path.join(os.tmpdir(), `${tempId}_output.mp4`);
    try {
        await fs.writeFile(inputPath, buffer);
        // Scale and pad to 1080x1350 with black background
        await execFileAsync('ffmpeg', [
            '-v', 'error',
            '-i', inputPath,
            '-vf', 'scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=black',
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-c:a', 'copy',
            '-y', // overwrite output if exists
            outputPath
        ], { maxBuffer: 10 * 1024 * 1024 });
        const outputBuffer = await fs.readFile(outputPath);
        return outputBuffer;
    }
    finally {
        try {
            await fs.unlink(inputPath);
        }
        catch (e) { }
        try {
            await fs.unlink(outputPath);
        }
        catch (e) { }
    }
}
