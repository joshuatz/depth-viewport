<script lang="ts">
	import { RawImage } from '@huggingface/transformers';
	import cn from 'cnfast';
	import * as ort from 'onnxruntime-web/webgpu';
	import { useThrottle, watch } from 'runed';
	import { onMount } from 'svelte';

	let {
		renderPreview = $bindable(true),
		mirrorVideo = false,
		deltaThreshold = 5,
		onDeltaThresholdReached = () => {},
		activationButton,
		// eslint-disable-next-line no-useless-assignment
		isActive: _isActive = $bindable(false),
		onIsActiveChange = () => {}
	}: {
		renderPreview?: boolean;
		mirrorVideo?: boolean;
		onDeltaThresholdReached?: (deltaObj: { x: number; y: number }) => unknown;
		deltaThreshold?: number;
		activationButton?: HTMLElement;
		isActive?: boolean;
		onIsActiveChange?: (isActive: boolean) => unknown;
	} = $props();

	let videoElem = $state<HTMLVideoElement>();
	let videoMirrorCanvas = $state<HTMLCanvasElement>();
	let outputVisualizationCanvas = $state<HTMLCanvasElement>();
	let stream = $state<MediaStream>();
	let error = $state<string | null>(null);
	let ortSession = $state<ort.InferenceSession>();
	let positionDeltas = $state({ x: 0, y: 0 });
	let isDetecting = false;
	let intrinsicVideoDims = $state({ width: 200, height: 200 });
	let isActive = $state(false);

	const throttledFaceDetector = useThrottle(
		async () => {
			if (isDetecting) return;
			isDetecting = true;
			try {
				await trackFaceONNX();
			} finally {
				isDetecting = false;
			}
		},
		() => 50
	);

	// Stores box relative to videoMirrorCanvas pixel dimensions
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

	const drawFrame = async () => {
		if (!videoElem || !videoMirrorCanvas || !outputVisualizationCanvas || !isActive) return;
		const videoFrameCtx = videoMirrorCanvas.getContext('2d');
		const outputVisCtx = outputVisualizationCanvas.getContext('2d');
		if (!videoFrameCtx || !outputVisCtx) return;

		const allCtx = [videoFrameCtx, outputVisCtx];

		// Clear & draw video
		allCtx.forEach((ctx, idx) => {
			if (!videoMirrorCanvas || !videoElem) {
				return;
			}
			const targetCanvas = idx === 0 ? videoMirrorCanvas : outputVisualizationCanvas;
			if (!targetCanvas) {
				return;
			}
			ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
			ctx.save();
			if (mirrorVideo) {
				ctx.scale(-1, 1);
			}
			ctx.drawImage(
				videoElem,
				mirrorVideo ? -targetCanvas.width : 0,
				0,
				targetCanvas.width,
				targetCanvas.height
			);
			ctx.restore();
		});

		throttledFaceDetector();

		// Overlay Bounding Box
		if (activeBox && videoMirrorCanvas.width > 0 && videoMirrorCanvas.height > 0) {
			outputVisCtx.save();

			// Compute scaling ratios between video mirror canvas and output canvas
			const scaleX = outputVisualizationCanvas.width / videoMirrorCanvas.width;
			const scaleY = outputVisualizationCanvas.height / videoMirrorCanvas.height;

			const boxW = activeBox.w * scaleX;
			const boxH = activeBox.h * scaleY;
			let bboxX = activeBox.x * scaleX;
			const bboxY = activeBox.y * scaleY;

			// Compensate for mirrored canvas
			if (mirrorVideo) {
				bboxX = outputVisualizationCanvas.width - (bboxX + boxW);
			}

			// Bounding box itself
			outputVisCtx.strokeStyle = '#EB4F26';
			outputVisCtx.lineWidth = 20;
			outputVisCtx.strokeRect(bboxX, bboxY, boxW, boxH);

			if (!renderPreview) {
				// Render face detection as just a box (completely obscure face)
				outputVisCtx.fillStyle = '#00FF00';
				outputVisCtx.fillRect(bboxX, bboxY, boxW, boxH);

				// Draw smiley face in the middle of the box
				const centerX = bboxX + boxW / 2;
				const centerY = bboxY + boxH / 2;
				const eyeRadius = boxW * 0.1;
				const smileRadius = boxW * 0.25;
				outputVisCtx.fillStyle = '#000000';

				// Left eye
				outputVisCtx.beginPath();
				outputVisCtx.arc(centerX - boxW * 0.2, centerY - boxH * 0.15, eyeRadius, 0, Math.PI * 2);
				outputVisCtx.fill();

				// Right eye
				outputVisCtx.beginPath();
				outputVisCtx.arc(centerX + boxW * 0.2, centerY - boxH * 0.15, eyeRadius, 0, Math.PI * 2);
				outputVisCtx.fill();

				// Smile
				outputVisCtx.beginPath();
				outputVisCtx.arc(centerX, centerY + boxH * 0.05, smileRadius, 0.1 * Math.PI, 0.9 * Math.PI);
				outputVisCtx.strokeStyle = '#000000';
				outputVisCtx.lineWidth = Math.max(2, boxW * 0.05);
				outputVisCtx.stroke();
			}

			// Solid fill background behind text
			outputVisCtx.fillStyle = '#00FF00';
			outputVisCtx.font = 'bold 16px sans-serif';
			const textWidth = outputVisCtx.measureText(activeBox.label).width;
			outputVisCtx.fillRect(bboxX, bboxY > 25 ? bboxY - 25 : bboxY, textWidth + 10, 22);

			// Text
			outputVisCtx.fillStyle = '#000000';
			outputVisCtx.fillText(activeBox.label, bboxX + 5, bboxY > 25 ? bboxY - 8 : bboxY + 16);

			outputVisCtx.restore();
		}

		if (isActive) {
			requestAnimationFrame(drawFrame);
		}
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
		if (!isActive) {
			return;
		}
		if (!videoMirrorCanvas) throw new Error('Canvas not available');
		const session = await initModel();
		const { targetHeightPx, targetWidthPx } = MODEL_CONFIG;

		const inputTensor = await prepareRGBInputTensor(
			videoMirrorCanvas,
			targetWidthPx,
			targetHeightPx
		);
		const results = await session.run({ input: inputTensor });

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
			positionDeltas = { x: 0, y: 0 };
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
		const scaleX = videoMirrorCanvas.width / targetWidthPx;
		const scaleY = videoMirrorCanvas.height / targetHeightPx;

		const boxWidth = Math.exp(dw) * stride * scaleX;
		const boxHeight = Math.exp(dh) * stride * scaleY;
		const centerX = (anchorX + dx * stride) * scaleX;
		const centerY = (anchorY + dy * stride) * scaleY;

		// Top-Left Corner
		const x = centerX - boxWidth / 2;
		const y = centerY - boxHeight / 2;

		// Compute delta from previous frame and accumulate
		if (activeBox) {
			const prevCenterX = activeBox.x + activeBox.w / 2;
			const prevCenterY = activeBox.y + activeBox.h / 2;
			const deltaFromPrevX = centerX - prevCenterX;
			const deltaFromPrevY = centerY - prevCenterY;

			positionDeltas.x += deltaFromPrevX;
			positionDeltas.y += deltaFromPrevY;

			const totalDelta = Math.sqrt(positionDeltas.x ** 2 + positionDeltas.y ** 2);
			if (totalDelta >= deltaThreshold) {
				onDeltaThresholdReached({ x: positionDeltas.x, y: positionDeltas.y });
				positionDeltas = { x: 0, y: 0 };
			}
		}

		// Update Svelte State
		const isLeft = centerX < videoMirrorCanvas.width / 2;
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

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	async function toggleActiveState(_evt?: Event) {
		if (isActive) {
			stop();
			return;
		}
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'user' }
			});
			if (videoElem) {
				videoElem.srcObject = stream;
				await videoElem.play();
			}
			// Just in case: to make sure video intrinsic dimensions are set
			await new Promise((res) => setTimeout(res, 50));
			if (videoMirrorCanvas && videoElem) {
				intrinsicVideoDims = {
					width: videoElem.videoWidth,
					height: videoElem.videoHeight
				};
			}
			isActive = true;
			requestAnimationFrame(drawFrame);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to access webcam';
			console.error(error);
			isActive = false;
		}
	}

	function stop() {
		if (!isActive) {
			console.warn(`Stop() called on already inactive instance`);
			return;
		}
		isActive = false;
		console.info('Stopping stream and setting isActive false');
		if (stream) {
			stream.getTracks().forEach((t) => t.stop());
		}
	}

	onMount(() => {
		// Disconnect camera stream on dismount
		return stop;
	});

	$effect(() => {
		if (activationButton) {
			activationButton.addEventListener('click', toggleActiveState);
		}
		return () => {
			if (activationButton) {
				activationButton.removeEventListener('click', toggleActiveState);
			}
		};
	});

	// Sync with bindable prop
	watch(
		() => isActive,
		(isActive) => {
			_isActive = isActive;
			onIsActiveChange(isActive);
		}
	);
</script>

{#if error}
	<p class="error">{error}</p>
{/if}

<video bind:this={videoElem} autoplay playsinline class="hidden"></video>
<canvas
	bind:this={videoMirrorCanvas}
	class="hidden"
	width={intrinsicVideoDims.width}
	height={intrinsicVideoDims.height}
></canvas>

<!-- Render output visualization canvas with explicit pixel dimensions -->
<canvas
	bind:this={outputVisualizationCanvas}
	width={intrinsicVideoDims.width}
	height={intrinsicVideoDims.height}
	style="aspect-ratio: {intrinsicVideoDims.width / intrinsicVideoDims.height};"
	class={cn('h-auto', {
		'fixed bottom-0 left-1 z-10 w-25 origin-bottom-left border border-dashed border-white opacity-60 hover:scale-200 hover:opacity-90':
			!renderPreview,
		'w-full': renderPreview,
		hidden: !isActive
	})}
></canvas>
