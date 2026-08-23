<script lang="ts">
	import {
		DEPTH_MODEL_OPTIONS,
		type DepthExtractionResults,
		type DepthModelOption,
		runDepthExtraction
	} from '$lib/processing';
	import { cn } from 'cnfast';
	import { ButtonGroup, Fileupload, Label, Range, Select, Spinner, Toggle } from 'flowbite-svelte';
	import { watch } from 'runed';
	import type { PerspectiveCamera, WebGLRenderer } from 'three';
	import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
	import LucideMousePointerClick from '~icons/lucide/mouse-pointer-click';
	import LucideRotate3d from '~icons/lucide/rotate-3d';
	import LucideScanFace from '~icons/lucide/scan-face';
	import FaceDetector from '../components/FaceDetector.svelte';
	import GyroInput from '../components/GyroInput.svelte';
	import ThreeRenderer from '../components/ThreeRenderer.svelte';

	let fileList = $state<FileList>();
	let previewImageSrcURI = $state<string>();
	let previewImageElem = $state<HTMLImageElement>();
	let depthExtractionResults = $state<DepthExtractionResults>();
	let threeJSControls = $state<OrbitControls>();
	let threeJSCamera = $state<PerspectiveCamera>();
	let threeJSRenderer = $state<WebGLRenderer>();
	let selectedDepthModel = $state<DepthModelOption>(DEPTH_MODEL_OPTIONS[0]);
	let displacementScale = $state(0.8);
	let renderWebCamPreview = $state(false);
	let webcamStreamTriggerButton = $state<HTMLElement>();
	let isProcessing = $state(false);

	type MovementInputType = 'cursor' | 'face' | 'gyro';
	let movementInputsActive = $state<Record<MovementInputType, boolean>>({
		cursor: true,
		face: false,
		gyro: false
	});
	let movementInputsCapable = $state<Record<MovementInputType, boolean>>({
		cursor: true,
		face: true,
		gyro: true
	});
	const movementInputIcons = {
		cursor: LucideMousePointerClick,
		face: LucideScanFace,
		gyro: LucideRotate3d
	};

	// Process file on input / file selection
	watch(
		() => ({ fileList, previewImageElem }),
		({ fileList, previewImageElem }) => {
			if (!fileList?.length || !previewImageElem) {
				previewImageSrcURI = undefined;
				return;
			}
			if (isProcessing) {
				return;
			}
			isProcessing = true;
			const objectURL = URL.createObjectURL(fileList[0]);

			previewImageSrcURI = objectURL;
			previewImageElem.onload = async () => {
				const imageBytes = await fileList![0].arrayBuffer();

				depthExtractionResults = await runDepthExtraction({
					imageBytes,
					mlPipelineInput: objectURL,
					model: selectedDepthModel
				});
				// Automatically tone-down the depth effect if the source is an embedded depth map
				if (depthExtractionResults.source === 'embedded') {
					displacementScale = 0.2;
				}
				URL.revokeObjectURL(objectURL);
				isProcessing = false;
			};
		}
	);

	// Enable / disable mouse controls
	$effect(() => {
		if (!threeJSControls || !threeJSRenderer) {
			return;
		}
		if (!movementInputsActive.cursor) {
			threeJSControls.disconnect();
		} else {
			threeJSControls.connect(threeJSRenderer.domElement);
		}
	});

	// Sync various different combinations of inputs, deactivated vs activated state
	watch(
		() => movementInputsActive.face,
		(faceActive) => {
			if (faceActive) {
				// Disable gyro to prevent conflict
				movementInputsActive.gyro = false;
			}
		}
	);
</script>

{#snippet InputModeButton(inputType: MovementInputType)}
	{@const Icon = movementInputIcons[inputType]}
	{@const active = movementInputsActive[inputType]}
	{@const disabled = !movementInputsCapable[inputType]}
	<button
		bind:this={() => undefined, (el) => inputType === 'face' && (webcamStreamTriggerButton = el)}
		type="button"
		title="Enable / disable {inputType} input"
		{disabled}
		onclick={() => {
			if (disabled || inputType === 'face') return;
			movementInputsActive[inputType] = !active;
		}}
		class={cn(
			'flex cursor-pointer items-center justify-center rounded-lg p-4 transition-all duration-200 select-none',
			{
				// Disabled: faded, no interaction
				'pointer-events-none cursor-not-allowed! opacity-40': disabled,
				// Active: blue highlight, raised with inner shadow
				'border border-blue-300 bg-blue-50 text-blue-700 shadow-md': active && !disabled,
				// Inactive: neutral, subtle flat design
				'border border-gray-200 bg-white text-gray-600 shadow-sm hover:bg-gray-50 hover:text-gray-900 hover:shadow-md':
					!active && !disabled
			}
		)}
	>
		<Icon />
	</button>
{/snippet}

{#snippet InputsAndConfig()}
	<div class="flex w-full flex-row flex-wrap gap-2 p-2 sm:flex-nowrap">
		<!-- Controls -->
		<div class="flex w-full flex-col flex-wrap gap-2 sm:w-4/12">
			<Label class={DEPTH_MODEL_OPTIONS.length == 1 ? 'hidden' : ''}>
				Model Selection
				<Select
					items={DEPTH_MODEL_OPTIONS.map((v) => ({
						value: v,
						name: `${v.repo}/${v.model_file_name}`
					}))}
					bind:value={selectedDepthModel}
				/>
			</Label>

			<!-- Input mode selector -->
			<ButtonGroup class="gap-2">
				{@render InputModeButton('cursor')}
				{@render InputModeButton('face')}
				{@render InputModeButton('gyro')}
			</ButtonGroup>

			<div class="w-full">
				<Label for="depth-effect-range">Depth Effect</Label>
				<Range
					id="depth-effect-range"
					min={0.1}
					max={2}
					step={0.1}
					bind:value={displacementScale}
				/>
			</div>

			<Toggle bind:checked={renderWebCamPreview}>Large WebCam Preview</Toggle>
		</div>

		<!-- Actual file selector -->
		<Fileupload class="grow" bind:files={fileList} clearable />
	</div>
{/snippet}

<div class="fixed top-0 left-0 flex h-screen w-screen flex-col">
	<div class="shrink-0 basis-auto">
		{@render InputsAndConfig()}
	</div>

	<FaceDetector
		renderPreview={renderWebCamPreview}
		onDeltaThresholdReached={(delta) => {
			if (!threeJSControls || !threeJSCamera) return;
			const parallaxStrength = 0.008;

			// Shift camera position to create parallax effect
			threeJSCamera.position.x -= delta.x * parallaxStrength;
			threeJSCamera.position.y += delta.y * parallaxStrength;

			threeJSControls.update();
		}}
		activationButton={webcamStreamTriggerButton}
		onIsActiveChange={(isActive) => {
			console.log(`FaceDetector status changed: ${isActive}`);
			movementInputsActive.face = isActive;
		}}
	/>

	<GyroInput
		visualize
		bind:isListening={
			() => false, (isListening) => !isListening && (movementInputsActive.gyro = false)
		}
		// Automatically disable gyro input when face input is active
		enabled={!movementInputsActive.face && movementInputsActive.gyro}
		webAPI="deviceorientation"
		threeInputs={{ camera: threeJSCamera, controls: threeJSControls }}
	/>

	<!-- Input image preview -->
	<img bind:this={previewImageElem} alt="Input preview" src={previewImageSrcURI} class="hidden" />

	<div class="relative flex w-full flex-1 grow flex-col">
		{#if isProcessing}
			<div class="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm">
				<div class="flex flex-col items-center gap-3">
					<Spinner type="default" color="primary" />
					<p class="text-sm font-medium text-gray-600">Processing...</p>
				</div>
			</div>
		{:else if !fileList?.length}
			<div class="absolute inset-0 flex items-center justify-center">
				<div class="flex flex-col items-center gap-4 text-gray-400">
					<LucideScanFace width={64} height={64} />
					<p class="text-lg font-medium">Upload an image to get started</p>
				</div>
			</div>
		{/if}

		{#if depthExtractionResults && previewImageElem}
			<ThreeRenderer
				depthMap={depthExtractionResults.depthMap}
				image={previewImageElem}
				bind:controls={threeJSControls}
				bind:camera={threeJSCamera}
				bind:displacementScale
				bind:renderer={threeJSRenderer}
			/>
		{/if}
	</div>
</div>
