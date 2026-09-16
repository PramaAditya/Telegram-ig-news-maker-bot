import QRCode from 'qrcode';

/**
 * Generates a high-contrast Base64 PNG data URL from a clean URL string.
 */
export async function generateQrCodeDataUrl(url: string): Promise<string> {
  if (!url || typeof url !== 'string' || !url.trim()) {
    throw new Error('URL cannot be empty for QR code generation');
  }

  const trimmed = url.trim();

  // Validate URL protocol
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Invalid URL protocol: ${parsed.protocol}`);
    }
  } catch (err: any) {
    throw new Error(`Invalid URL for QR generation: ${err.message}`);
  }

  return await QRCode.toDataURL(trimmed, {
    width: 600,
    margin: 1,
    color: {
      dark: '#000000',
      light: '#ffffff'
    },
    errorCorrectionLevel: 'M'
  });
}
