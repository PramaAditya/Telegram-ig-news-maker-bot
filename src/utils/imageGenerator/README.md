# Image Generator Utility (`imageGenerator`)

Pure **Text-to-Image** generation utility powered by Google Gemini image models (`gemini-3.1-flash-image-preview` / `IMAGE_GENERATION_MODEL`) and AWS S3 storage.

---

## Features
- **Deterministic Style Presets**:
  - `dramatic`: Sinematik chiaroscuro, intense rim lighting, low-key, edges memudar ke pitch-black void.
  - `realistic`: Fotojurnalistik dokumenter 35mm, pencahayaan natural daylight / ambient, tanpa framing gelap buatan.
  - `custom`: Menggunakan prompt murni tanpa penambahan akhiran gaya preset.
- **Built-in Resilience**: 3x retry otomatis dengan exponential backoff jika API mengalami rate limit / error.
- **Safe Fallback**: Fallback ke pixel hitam transparan jika seluruh percobaan gagal.
- **Direct S3 Integration**: Otomatis mengunggah buffer ke AWS/GCP S3 dan mengembalikan CDN URL.

---

## Installation & Import

```ts
import { imageGenerator } from '@/utils/imageGenerator/index.js';
```

---

## Usage Examples

### 1. Realistic Documentary Style (Content Slides / Neutral News)
```ts
const result = await imageGenerator({
  prompt: 'Humanoid robot assembling electronics in modern factory',
  style: 'realistic',
  aspectRatio: '1:1',
  uploadToS3: true,
});

console.log(result.url); // CDN URL
```

### 2. Dramatic Chiaroscuro Style (Breaking News Hero Cover)
```ts
const result = await imageGenerator({
  prompt: 'Summit stage with speaker under heavy spotlight',
  style: 'dramatic',
  aspectRatio: '1:1',
  uploadToS3: true,
});
```

---

## Options (`ImageGeneratorOptions`)

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `prompt` | `string` | *Required* | Deskripsi teks gambar yang ingin dibangkitkan |
| `style` | `'dramatic' \| 'realistic' \| 'custom'` | `'dramatic'` | Preset visual yang diterapkan |
| `aspectRatio` | `AspectRatio` | `'1:1'` | Rasio aspek output (1:1, 16:9, 4:5, dll) |
| `size` | `'1K' \| '2K' \| '4K'` | `'1K'` | Resolusi output |
| `uploadToS3` | `boolean` | `true` | Otomatis upload ke S3 dan isi `result.url` |
| `maxRetries` | `number` | `3` | Batas maksimum retry jika API gagal |
