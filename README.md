This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

High-level workflow (user-facing)

Name the model — from Dashboard (pop-up) or in flow.

Choose: Upload references OR Generate from scratch.

Upload references: user uploads face/body images.

Generate from scratch: user provides a prompt (optionally some image ref), a face image is generated.

Preprocess (server worker): create thumbnails, prepare face crop, etc.

Generate model sheet: worker creates 4 body views + 9 face angles (via Replicate / chosen model).

Preview step: user inspects generated previews, can Edit or Regenerate.

Upscale (optional): create high-res versions.

Finalize: mark subject ready for use in photoshoot generation.

What we’ve implemented so far (summary)
Frontend components (key)

CreateModelFlow.jsx — flow coordinator / state machine and progress bar.

StartStep, ChoiceStep, UploadStep, GenerateStep, GeneratePreviewStep, GenerateSheetStep, UpscaleStep, FinalizeStep — step UIs (some fully implemented; others skeletons).

UploadAsset.jsx — drag-and-drop / file upload UI that calls /api/upload.

PreviewAndGenerateControls.jsx — preview/finalize controls (earlier).

BottomNotification.jsx — bottom notification UI (auto dismiss).

ProgressBar.jsx — shows flow position.

ModelSheetViewer.jsx — (you had attempted; may need small fixes) — displays subject assets.

Server routes (app router)

POST /api/upload — save uploaded base64 file to public/uploads/ and return { url, filename }.

POST /api/subject — create a subject record in data/subjects/ and enqueue preprocess job in data/jobs/.

Accepts faceRefs/bodyRefs as {filename, b64} or {url}. draft: true allows skipping the strict "must provide reference" validation for generate-from-scratch flow.

GET /api/subject/:id/status — returns the subject JSON for polling (used by front end).

POST /api/subject/:id/generate-model-sheet — enqueues a job to create the model sheet for the subject (worker picks it up).

POST /api/subject/:id/generate-face — (example) endpoint to call Replicate / nano-banana to create a face and store as an asset. (You implemented replicate run there.)

(Other routes exist in your tree: /api/assemble, /api/generate etc.)

Worker

worker/process-jobs.js — long-running worker that polls data/jobs/*.json and processes jobs:

preprocess job — creates thumbnails, optional pose maps, and sets subject.status to awaiting-approval.

generate-views / generate-model-sheet job — calls Replicate (or other hosted model) to generate views and store generated images in public/generated/.

generate-face job — use "nano-banana" or another model to produce a single face image.

The worker reads/writes:

data/subjects/*.json — subject metadata and assets list

data/jobs/*.json — job queue

public/uploads/ — user-uploaded files

public/generated/ — generated images

Utilities added

subjectStatus.js — centralizes server->client status mapping.

useSubjectPoll.js — hook to poll subject status and return mapped state.

Subject lifecycle & statuses

Server status strings (examples):

queued / preprocess / preprocessing — uploads are being processed

awaiting-approval — previews created, waiting for user approval

sheet_generated / preview_ready — previews ready

generated / ready — final assets generated

failed / error — something went wrong

draft / awaiting_prompt / awaiting-generation — used for generate-from-scratch flow (subject created but no images yet)

Client flow steps:

choose — user chooses upload or generate

generate — prompt editor to create from scratch

generating-sheet — worker running generation

generate-preview — preview step where user accepts / edits

uploading / validating — upload references and server-side preprocessing

upscaling — upscaling step

finalize / ready — final state

Mapping: mapServerStatus(subject) translates server statuses into a client flow step. We implemented logic to avoid stomping the editor UI while the server transitions.

Environment variables required

REPLICATE_API_TOKEN — token for Replicate API (if using replicate).

REPLICATE_MODEL_NAME — "google/nano-banana" or the model used.

REPLICATE_MODEL_VERSION — optional version id or model:version.

OPENAI_API_KEY — if you use OpenAI endpoints elsewhere (previous code used it).

Make sure these are set in your environment (or .env.local for local Next app with process.env.* during build/runtime).

How to run locally

Install dependencies:

npm install
npm install sharp uuid replicate

If node complains about node-fetch you can remove the import and use global fetch in Node 18+. If using Node <18, install node-fetch.

Ensure package.json contains "type": "module" if your worker is ESM and you import files with .js ESM syntax. (Warning: mixing CJS/ESM can cause errors.)

Start Next app:

npm run dev


Run worker in a separate terminal:

node worker/process-jobs.js


or (if using nodemon)

nodemon worker/process-jobs.js

Common issues & debugging tips

File not found warnings in worker preprocess:

Verify public/uploads/<filename> exists; UploadAsset and api/upload return /uploads/<filename>, and the worker resolveUploadFile() should map that to process.cwd()/public/uploads/<filename>. If uploads have spaces or odd characters, sanitization may alter filename — ensure UploadAsset uses returned filename and stores it in the subject record.

params warning for Next dynamic route:

In Next app-router API route handlers, some Next versions pass params as a promise-like object. Use the pattern:

const params = context?.params;
const resolved = params && typeof params.then === 'function' ? await params : params;
const { id } = resolved || {};


Replicate errors:

If model complains "Unable to detect your face": your provided face crop isn't clear enough — use a frontal, high-contrast face image.

replicate.run output can be urls, or objects. Make sure normalization handles all shapes (we added normalizeReplicateOutput earlier).

Some replicate outputs are functions (e.g., objects containing url() method). For replicate client v? output shape can differ — inspect raw response and adapt normalizeReplicateOutput.

Worker can't find node-fetch:

With Node 18+ use global fetch and remove import fetch from 'node-fetch'; or install node-fetch for Node <18.

UI flashes / auto-advance:

This happens when server status briefly moves to awaiting-approval then back; our hook and mapServerStatus try to be conservative and return null when ambiguous.
