<script lang="ts">
	import { RawImage } from '@huggingface/transformers';
	import * as ort from 'onnxruntime-web/webgpu';
	import { onMount } from 'svelte';

	let {
		renderPreview = $bindable(true),
		mirrorVideo = false
	}: {
		renderPreview?: boolean;
		mirrorVideo?: boolean;
	} = $props();

	let videoElem = $state<HTMLVideoElement>();
	let canvasElem = $state<HTMLCanvasElement>();
	let stream = $state<MediaStream>();
	let error = $state<string | null>(null);
	let ortSession = $state<ort.InferenceSession>();

	// Store box in state so drawFrame() keeps it on screen across 60fps renders
	let activeBox = $state<{
		x: number;
		y: number;
		w: number;
		h: number;
		label: string;
	} | null>(null);

	const MODEL_CONFIG = {
		onnxUri: `https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx`,
		targetWidthPx: 640,
		targetHeightPx: 640
	};

	const initModel = async (): Promise<ort.InferenceSession> => {
		if (ortSession) return ortSession;
		ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@latest/dist/';
		ortSession = await ort.InferenceSession.create(MODEL_CONFIG.onnxUri, {
			executionProviders: ['webgpu', 'wasm']
		});
		return ortSession;
	};

	const drawFrame = () => {
		if (!videoElem || !canvasElem) return;
		const ctx = canvasElem.getContext('2d');
		if (!ctx) return;

		// Clear & Draw Mirrored Video
		ctx.clearRect(0, 0, canvasElem.width, canvasElem.height);
		ctx.save();
		if (mirrorVideo) {
			ctx.scale(-1, 1);
		}
		ctx.drawImage(
			videoElem,
			mirrorVideo ? -canvasElem.width : 0,
			0,
			canvasElem.width,
			canvasElem.height
		);
		ctx.restore();

		// Overlay Bounding Box
		if (activeBox) {
			ctx.save();
			let bboxX = activeBox.x;
			// Compensate for mirrored canvas
			if (mirrorVideo) {
				bboxX = canvasElem.width - (activeBox.x + activeBox.w);
			}

			ctx.strokeStyle = '#00FF00';
			ctx.lineWidth = 3;
			ctx.strokeRect(bboxX, activeBox.y, activeBox.w, activeBox.h);

			ctx.fillStyle = '#00FF00';
			ctx.font = 'bold 16px sans-serif';
			const textWidth = ctx.measureText(activeBox.label).width;
			ctx.fillRect(bboxX, activeBox.y > 25 ? activeBox.y - 25 : activeBox.y, textWidth + 10, 22);

			ctx.fillStyle = '#000000';
			ctx.fillText(
				activeBox.label,
				bboxX + 5,
				activeBox.y > 25 ? activeBox.y - 8 : activeBox.y + 16
			);
			ctx.restore();
		}

		requestAnimationFrame(drawFrame);
	};

	async function prepareRGBInputTensor(
		canvas: HTMLCanvasElement,
		targetWidth: number,
		targetHeight: number
	): Promise<ort.Tensor> {
		const rawImg = await RawImage.fromCanvas(canvas);
		const resized = await rawImg.resize(targetWidth, targetHeight);

		const rgbaData = resized.data;
		const numPixels = targetWidth * targetHeight;
		const float32Data = new Float32Array(3 * numPixels);

		// Convert RGBA -> Planar RGB NCHW
		for (let i = 0; i < numPixels; i++) {
			float32Data[i] = rgbaData[i * 4]; // Red
			float32Data[numPixels + i] = rgbaData[i * 4 + 1]; // Green
			float32Data[2 * numPixels + i] = rgbaData[i * 4 + 2]; // Blue
		}

		return new ort.Tensor('float32', float32Data, [1, 3, targetHeight, targetWidth]);
	}

	async function trackFaceONNX() {
		if (!canvasElem) throw new Error('Canvas not available');
		const session = await initModel();
		const { targetHeightPx, targetWidthPx } = MODEL_CONFIG;

		const inputTensor = await prepareRGBInputTensor(canvasElem, targetWidthPx, targetHeightPx);
		const results = await session.run({ input: inputTensor });

		console.log(results);

		const stride: 8 | 16 | 32 = 32;

		const objScores = results[`obj_${stride}`].data as Float32Array;
		const bboxData = results[`bbox_${stride}`].data as Float32Array;

		if (!objScores || objScores.length === 0) return null;

		// Find Highest Confidence Anchor
		let maxScore = -Infinity;
		let maxIndex = -1;
		for (let i = 0; i < objScores.length; i++) {
			if (objScores[i] > maxScore) {
				maxScore = objScores[i];
				maxIndex = i;
			}
		}

		if (maxIndex === -1 || maxScore < 0.005) {
			console.warn('No face detected above threshold');
			activeBox = null;
			return null;
		}

		// 2. Calculate Stride-x Anchor Grid Coordinates

		const cols = targetWidthPx / stride;
		const anchorX = (maxIndex % cols) * stride + stride / 2;
		const anchorY = Math.floor(maxIndex / cols) * stride + stride / 2;

		// Decode Raw Offsets relative to Anchor Box
		const bboxOffset = maxIndex * 4;
		const dx = bboxData[bboxOffset];
		const dy = bboxData[bboxOffset + 1];
		const dw = bboxData[bboxOffset + 2];
		const dh = bboxData[bboxOffset + 3];

		// Apply grid offsets and scale back to full canvas pixel dimensions
		const scaleX = canvasElem.width / targetWidthPx;
		const scaleY = canvasElem.height / targetHeightPx;

		const boxWidth = Math.exp(dw) * stride * scaleX;
		const boxHeight = Math.exp(dh) * stride * scaleY;
		const centerX = (anchorX + dx * stride) * scaleX;
		const centerY = (anchorY + dy * stride) * scaleY;

		// Top-Left Corner
		const x = centerX - boxWidth / 2;
		const y = centerY - boxHeight / 2;

		// Update Svelte State
		const isLeft = centerX < canvasElem.width / 2;
		activeBox = {
			x,
			y,
			w: boxWidth,
			h: boxHeight,
			label: `Face (${isLeft ? 'Left' : 'Right'})`
		};

		return {
			score: maxScore,
			isLeft,
			box: activeBox
		};
	}

	onMount(async () => {
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'user' }
			});
			if (videoElem) {
				videoElem.srcObject = stream;
				await videoElem.play();
			}
			if (canvasElem && videoElem) {
				canvasElem.width = videoElem.videoWidth || 640;
				canvasElem.height = videoElem.videoHeight || 480;
			}
			requestAnimationFrame(drawFrame);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to access webcam';
		}
	});

	$effect(() => {
		if (!renderPreview && stream) {
			stream.getTracks().forEach((t) => t.stop());
		}
	});
</script>

{#if error}
	<p class="error">{error}</p>
{/if}

<video bind:this={videoElem} autoplay playsinline class:hidden={!renderPreview}></video>

<canvas bind:this={canvasElem} class:hidden={!renderPreview}></canvas>

<button
	type="button"
	onclick={async () => {
		const result = await trackFaceONNX();
		console.log(result);
	}}>Detect</button
>
