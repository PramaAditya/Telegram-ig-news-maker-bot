# Create Template Skill

**Name:** create-template
**Description:** Guide for adding new templates to the IG News Maker Bot.

## Workflow Overview

To add a new template, follow these three steps:

1. **HTML/CSS (Media Renderer)**
2. **AI Pipeline**
3. **Registration**

Because the system is data-driven, you do *not* need to modify the media renderer's server code or the frontend Vue application.

---

### 1. HTML/CSS Templates
**Location:** `services/media-renderer/templates/<mediaType>/<brand>/<template_name>/`

Create the Handlebars (`.html`) templates. The renderer receives a `pages` array, and for each page, it compiles `file.html` passing the `context` variables.

**Example `cover.html`:**
```html
<div class="cover">
  <img src="{{cover_image}}" />
  <h1>{{{title}}}</h1> <!-- Use triple braces for HTML/markdown injected from the pipeline -->
  <img src="{{logo}}" class="logo" />
</div>
```

### 2. AI Pipeline
**Location:** `src/agents/pipelines/<mediaType>/<brand>/<template_name>.ts`

This file handles research parsing, Zod schemas, image generation/curation, and UI schema.

**Key Components to Export:**
- `templateConfig`: Defines the ID, name, description, and the `uiSchema` for the frontend.
- `run[TemplateName]Pipeline`: The main function called by the worker.
- `generate[TemplateName]Media`: Called during generation and when regenerating media from the dashboard.

**Example `generateMedia` mapping:**
```typescript
export async function generateMyTemplateMedia(templateData: any, settings: any): Promise<{ type: 'image' | 'video', url: string }[]> {
  const pages: any[] = [];
  
  pages.push({
    file: 'cover', // corresponds to cover.html
    context: {
      cover_image: templateData.coverImageUrl,
      title: marked.parseInline(templateData.title || '')
    }
  });

  // Slides mapping
  templateData.slides.forEach((slide: any, i: number) => {
    pages.push({
      file: 'slide', // corresponds to slide.html
      context: { text: marked.parse(slide.text || '') }
    });
  });

  const renderPayload = {
    viewport: { width: 1080, height: 1350 },
    pages
  };

  const renderedUrls = await generateMedia('/render/image/my.brand/my_template', renderPayload);

  return renderedUrls.map((url: string) => ({ type: 'image' as const, url }));
}
```

**Example `uiSchema` for Frontend:**
```typescript
uiSchema: [
  { name: 'title', type: 'text', label: 'Title', aiContext: 'Prompt for refining title' },
  { name: 'coverImageUrl', type: 'image', label: 'Cover Image' },
  { name: 'slides', type: 'array', label: 'Slides', itemType: 'object', itemSchema: [
    { name: 'text', type: 'text', label: 'Slide Text', aiContext: 'Prompt for slide text' },
    { name: 'slide_image', type: 'image', label: 'Background Image' }
  ]}
]
```

### 3. Registration
**Location:** `src/templates.ts`

Import your new pipeline config and add it to the `TEMPLATES` record object.

```typescript
import { runMyTemplatePipeline, myTemplateConfig, generateMyTemplateMedia } from './agents/pipelines/image/my.brand/my_template.js';

export const TEMPLATES: Record<string, TemplateConfig> = {
  // ... existing templates ...
  [myTemplateConfig.id]: {
    ...myTemplateConfig,
    runPipeline: runMyTemplatePipeline,
    regenerateMedia: generateMyTemplateMedia
  }
};
```