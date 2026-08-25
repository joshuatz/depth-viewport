<script lang="ts">
	import {
		DEPTH_MODEL_OPTIONS,
		type DepthExtractionResults,
		type DepthExtractionSource,
		type DepthExtractionSourceID,
		type DepthModelOption,
		getAvailableDepthExtractionSources,
		runDepthExtractionML
	} from '$lib/processing';
	import { cn } from 'cnfast';
	import {
		Alert,
		ButtonGroup,
		Fileupload,
		Label,
		Modal,
		Popover,
		Range,
		Select,
		Spinner,
		Toggle
	} from 'flowbite-svelte';
	import { PersistedState, resource, watch } from 'runed';
	import type { PerspectiveCamera, WebGLRenderer } from 'three';
	import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
	import LucideBadgeInfo from '~icons/lucide/badge-info';
	import LucideMousePointerClick from '~icons/lucide/mouse-pointer-click';
	import LucideRotate3d from '~icons/lucide/rotate-3d';
	import LucideScanFace from '~icons/lucide/scan-face';
	import FaceDetector from '../components/FaceDetector.svelte';
	import GyroInput from '../components/GyroInput.svelte';
	import ThreeRenderer from '../components/ThreeRenderer.svelte';

	let fileList = $state<FileList>();
	let previewImageSrcURI = $state<string>();
	let previewImageElem = $state<HTMLImageElement>();
	let threeJSControls = $state<OrbitControls>();
	let threeJSCamera = $state<PerspectiveCamera>();
	let threeJSRenderer = $state<WebGLRenderer>();
	let selectedDepthModel = $state<DepthModelOption>(DEPTH_MODEL_OPTIONS[0]);
	let displacementScale = $state(0.8);
	let renderWebCamPreview = $state(false);
	let webcamStreamTriggerButton = $state<HTMLElement>();
	let processingStatus = $state<
		'unset' | 'checking_input' | 'awaiting_extraction' | 'extracting' | 'complete'
	>('unset');
	let showInfoModal = $state(false);

	/**
	 * The depth ML pipeline is heavy; users should be warned before downloading
	 */
	const depthModelSizeWarningAcknowledged = new PersistedState(
		'depthModelSizeWarningAcknowledged',
		false
	);

	/**
	 * Tracks all the various parts of the image processing pipeline and final state
	 */
	let currentImageState = $state<{
		imageBytes?: ArrayBuffer;
		objectURL?: string;
		depthExtractionSource?: DepthExtractionSource;
		confirmedSource?: DepthExtractionSourceID;
		depthExtractionResults?: DepthExtractionResults;
	}>({});

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

	const loadSampleImage = async () => {
		const response = await fetch('/falling_water_full_res.jpg');
		const blob = await response.blob();
		const file = new File([blob], 'fallingwater.jpg', { type: blob.type });
		const dt = new DataTransfer();
		dt.items.add(file);
		fileList = dt.files;
	};

	// Process file on input / file selection
	watch(
		() => ({ fileList, previewImageElem }),
		({ fileList, previewImageElem }) => {
			if (!fileList?.length || !previewImageElem) {
				previewImageSrcURI = undefined;
				currentImageState = {};
				return;
			}
			if (processingStatus !== 'unset' && processingStatus !== 'complete') {
				return;
			}
			currentImageState = {};
			processingStatus = 'checking_input';
			const objectURL = URL.createObjectURL(fileList[0]);

			previewImageSrcURI = objectURL;
			previewImageElem.onload = async () => {
				const imageBytes = await fileList![0].arrayBuffer();
				currentImageState.imageBytes = imageBytes;
				currentImageState.objectURL = objectURL;

				// Check if we can use embedded depth map vs forced to use ML
				currentImageState.depthExtractionSource = await getAvailableDepthExtractionSources({
					imageBytes
				});

				// If ML is only option, but user has already confirmed, just set state directly to trigger processing
				if (
					depthModelSizeWarningAcknowledged.current === true &&
					currentImageState.depthExtractionSource.source === 'ml'
				) {
					currentImageState.confirmedSource = 'ml';
				}

				processingStatus = 'awaiting_extraction';
			};
		}
	);

	// Watch for when we are ready to start processing
	resource(
		() => ({ currentImageState: $state.snapshot(currentImageState), processingStatus }),
		async () => {
			if (
				processingStatus !== 'awaiting_extraction' ||
				!currentImageState.depthExtractionSource ||
				!currentImageState.confirmedSource ||
				!!currentImageState.depthExtractionResults
			) {
				return;
			}
			processingStatus = 'extracting';

			if (currentImageState.confirmedSource === 'ml' && currentImageState.objectURL) {
				// Reset to default for ML
				displacementScale = 0.8;
				// Remember that user has opted-in to fetching ML model
				depthModelSizeWarningAcknowledged.current = true;

				currentImageState.depthExtractionResults = await runDepthExtractionML({
					model: selectedDepthModel,
					mlPipelineInput: currentImageState.objectURL
				});
			} else if (
				currentImageState.confirmedSource === 'embedded' &&
				currentImageState.depthExtractionSource.source === 'embedded'
			) {
				// Automatically tone-down the depth effect if the source is an embedded depth map
				displacementScale = 0.2;
				// We already have the embedded depth map - just need to set it in state
				currentImageState.depthExtractionResults = currentImageState.depthExtractionSource;
			}

			// We can release / revoke this now
			if (currentImageState.objectURL) {
				URL.revokeObjectURL(currentImageState.objectURL);
			}

			processingStatus = 'complete';
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
	<Popover>
		<div class="flex flex-col gap-2">
			<h3>Input Mode: {inputType}</h3>
			{#if inputType === 'face'}
				<Alert color="warning">
					<span
						>Warning: Enabling face controls will fetch ~6 MB in resources to run in-browser
						inference.</span
					>
				</Alert>
			{/if}
		</div>
	</Popover>
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

		<div class="flex grow flex-row flex-nowrap items-start">
			<div class="flex w-full flex-row">
				<!-- Actual file selector -->
				<Fileupload class="grow" bind:files={fileList} clearable />
				<button
					type="button"
					onclick={() => (showInfoModal = true)}
					class="flex items-center justify-center p-4 pt-3 text-lg"
				>
					<LucideBadgeInfo />
				</button>
			</div>
		</div>
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
			// (note that these are both inverted)
			threeJSCamera.position.x -= delta.x * parallaxStrength;
			threeJSCamera.position.y -= delta.y * parallaxStrength;

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
		<!-- Processing / loading spinner -->
		{#if processingStatus !== 'complete' && processingStatus !== 'unset'}
			<div class="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm">
				<div class="flex flex-col items-center gap-3">
					<Spinner type="default" color="primary" />
					<p class="text-sm font-medium text-gray-600">Processing...</p>
				</div>
			</div>
			<!-- No file selected yet -->
		{:else if !fileList?.length}
			<div class="absolute inset-0 flex items-center justify-center">
				<div class="flex flex-col items-center gap-4 text-gray-400">
					<LucideScanFace width={64} height={64} />
					<p class="text-xl font-medium">Upload an image to get started</p>
					<p class="text-lg font-medium">
						Or, <button class="text-purple-600" onclick={loadSampleImage}
							>try the sample image.</button
						>
					</p>
				</div>
			</div>
		{/if}

		<!-- User needs to confirm fetch of ML model -->
		{#if currentImageState.depthExtractionSource?.source === 'ml' && !depthModelSizeWarningAcknowledged.current}
			<div
				class="absolute inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm"
			>
				<div class="mx-4 max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-xl">
					<h3 class="mb-2 text-lg font-semibold text-gray-900">Download Depth Model Required</h3>
					<Alert color="warning" class="mb-4">
						<span
							>Fetching the depth extraction model will download ~100 MB of resources for in-browser
							inference.</span
						>
					</Alert>
					<div class="flex justify-end gap-3">
						<button
							type="button"
							onclick={() => {
								currentImageState.depthExtractionSource = undefined;
							}}
							class="cursor-pointer rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
						>
							Cancel
						</button>
						<button
							type="button"
							onclick={() => {
								currentImageState.confirmedSource = 'ml';
							}}
							class="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
						>
							Continue
						</button>
					</div>
				</div>
			</div>
		{/if}

		<!-- User needs to choose between embedded and ML model -->
		{#if currentImageState.depthExtractionSource?.source === 'embedded' && !currentImageState.confirmedSource}
			<div
				class="absolute inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm"
			>
				<div class="mx-4 max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-xl">
					<h3 class="mb-2 text-lg font-semibold text-gray-900">Choose Depth Source</h3>
					<p class="mb-4 text-sm text-gray-600">
						This image contains an embedded depth map. You can use it directly, or run ML extraction
						(requires ~100 MB model) for a (generally) more impressive result.
					</p>
					<div class="flex justify-end gap-3">
						<button
							type="button"
							onclick={() => {
								currentImageState.confirmedSource = 'ml';
							}}
							class="cursor-pointer rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
						>
							Use ML Model
						</button>
						<button
							type="button"
							onclick={() => {
								currentImageState.confirmedSource = 'embedded';
							}}
							class="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
						>
							Use Embedded Depth Map
						</button>
					</div>
				</div>
			</div>
		{/if}

		<!-- Actual results -->
		{#if currentImageState.depthExtractionResults && previewImageElem}
			<ThreeRenderer
				depthMap={currentImageState.depthExtractionResults.depthMap}
				image={previewImageElem}
				bind:controls={threeJSControls}
				bind:camera={threeJSCamera}
				bind:displacementScale
				bind:renderer={threeJSRenderer}
			/>
		{/if}
	</div>
</div>

<Modal bind:open={showInfoModal} title="About">
	<div class="flex flex-col gap-4 text-sm text-gray-600">
		<p>A depth visualization tool powered by in-browser ML and/or embedded depth maps.</p>
		<p>
			Depth viewport can be controlled with a standard mouse / touch input, as well as your face's
			relative position, or your phone's gyroscope (depending on capabilities) - all for a more
			immersive parallax effect.
		</p>
		<p>
			Created by
			<a
				href="https://joshuatz.com/"
				target="_blank"
				class="text-blue-600 underline transition-colors hover:text-blue-800"
			>
				Joshua Tzucker
			</a>
		</p>
		<p>
			View the source code on
			<a
				href="https://github.com/joshuatz/depth-viewport"
				target="_blank"
				class="text-blue-600 underline transition-colors hover:text-blue-800"
			>
				GitHub
			</a>
		</p>
		<p>
			Sample image, CC 3.0 Attribution: <a
				href="https://en.wikipedia.org/wiki/File:Wrightfallingwater.jpg"
				target="_blank"
				class="text-blue-600 underline transition-colors hover:text-blue-800"
				>Wikimedia Commons, Sxenko</a
			>
		</p>
	</div>
</Modal>
