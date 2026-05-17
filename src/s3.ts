import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
});

const bucketName = process.env.S3_BUCKET!;
const rootFolder = process.env.S3_ROOT_FOLDER || 'IGNewsMakerBot';
const publicUrlBase = process.env.S3_PUBLIC_URL_BASE!;

export async function uploadToS3(buffer: Buffer, mimeType: string, extension: string): Promise<string> {
  const fileName = `${rootFolder}/${uuidv4()}${extension}`;
  
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: buffer,
    ContentType: mimeType,
    ACL: 'public-read',
  });

  await s3Client.send(command);

  const baseUrl = publicUrlBase.endsWith('/') ? publicUrlBase.slice(0, -1) : publicUrlBase;
  return `${baseUrl}/${fileName}`;
}
