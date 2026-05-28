# Retrospective: Adding a New Template

Based on the implementation of the `carousel_multi_images` template, here is a complete checklist of all the files that need to be added or modified when introducing a new template to the IG News Maker Bot architecture.

## 1. HTML Templates (Media Renderer)
**Location:** `services/media-renderer/templates/<mediaType>/<brand>/<template_name>/`

You need to create the HTML/CSS template files that will be processed by Handlebars and rendered into images by Puppeteer.
* **Added:** `cover.html` (The first slide/cover design)
* **Added:** `slide.html` (The design for the content slides)
* **Added:** `image.html` (Optional, if your template supports trailing raw images)

## 2. AI Pipeline & Configuration
**Location:** `src/agents/pipelines/<mediaType>/<brand>/<template_name>.ts`

This file contains the core AI logic that instructs the LLM how to generate text, curate images, and process the data for this specific template.
* **Added:** A new TypeScript pipeline file.
  * Define the `TemplateConfig` (id, name, description).
  * Define the Zod `schema` matching the exact data fields required by your HTML templates (e.g., `slide_image`, `text`).
  * Implement the `run[TemplateName]Pipeline` function (handles LLM generation, image curation via `curateImages`, API calls, and pushing to the Queue).
  * Implement the `generate[TemplateName]Media` function (formats the payload that gets sent to the media-renderer).

## 3. Registering the Template
**Location:** `src/templates.ts`

You must register the new pipeline so the Telegram bot and the backend worker are aware of its existence.
* **Modified:** Import your newly created config and pipeline functions.
* **Modified:** Add the new template to the exported `TEMPLATES` record object. *(This automatically exposes it to the Telegram bot).*

## 4. Media Renderer Server Logic
**Location:** `services/media-renderer/server.js`

The Puppeteer rendering API needs to know how to map your incoming JSON payload to the Handlebars HTML templates.
* **Modified:** Find the `app.post('/render/:mediaType/:brand/:templateName')` endpoint.
* **Modified:** Add an `if (templateName === 'your_new_template')` block (or append to an existing one) to handle passing the correct variables (e.g., looping through `slides` and injecting `slide_image`) to the compiled Handlebars templates.

## 5. Frontend UI (Vue Dashboard)
**Location:** `frontend/src/views/`

To allow users to manually select, generate, or edit the template from the web dashboard.
* **Modified `CreatePost.vue`:** Add the new template to the `<select v-model="templateId">` dropdown options so users can select it when generating a new post manually.
* **Modified `Ideas.vue`:** Update any fallback or default template selections (e.g., `selectedTemplates.value[ideaId] || 'image:kabar.perjuangan:your_new_template'`).
* **Modified `PostDetail.vue`:** 
  * Update `v-if` conditions that check for specific template IDs to show the correct advanced editing UI.
  * Define how the `post.templateData.slides` should be initialized if it's empty (e.g., as an array of strings or an array of objects).
  * Add custom input UI components (like `<ImageUploader>`) if the new template introduces new variables (like a background image for each individual slide).