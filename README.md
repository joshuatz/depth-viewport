# Depth Viewport

A 100% client-side web app that transforms 2D images into interactive 3D parallax viewports using in-browser ML depth estimation and Three.js.

Use your mouse, face, or gyroscope / phone position to control!

## Features

- **Depth map extraction** — Load images with embedded depth maps (from compatible smartphones) or run the Depth Anything V2 model directly in the browser via Hugging Face Transformers
- **3D viewport** — Extracted depth map is used, creating an immersive parallax effect
- **Multiple input modes** — Control the camera with mouse/touch (OrbitControls), face tracking via webcam (YUNet ONNX model), or device gyroscope/orientation sensors
- **Fully offline** — After initial page load, everything runs client-side with no server required (excluding demo image)

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | SvelteKit + Svelte 5 |
| Build | Vite |
| Styling | Tailwind CSS + Flowbite-Svelte |
| 3D | Three.js + custom GLSL shaders |
| ML | Hugging Face Transformers (Depth Anything V2), ONNX Runtime Web (YUNet) |

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Build for production |

## Notes

> [!WARNING]
> Some web APIs require HTTPS to work (e.g., face tracking, device orientation). You will need to use a local tunnel or self-signed SSL workflow to test those features locally.
