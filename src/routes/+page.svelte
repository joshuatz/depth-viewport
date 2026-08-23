<script lang="ts">
	import { DEPTH_MODEL_OPTIONS, type DepthModelOption, runDepthEstimation } from '$lib/processing';
	import type { DepthEstimationOutput } from '@huggingface/transformers';
	import { Fileupload, Label, Range, Select, Toggle } from 'flowbite-svelte';
	import { PerspectiveCamera } from 'three';
	import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
	import FaceDetector from '../components/FaceDetector.svelte';
	import ThreeRenderer from '../components/ThreeRenderer.svelte';
	let fileList = $state<FileList>();
	let previewImageSrcURI = $state<string>();
	let previewImageElem = $state<HTMLImageElement>();
	let depthEstimationResults = $state<DepthEstimationOutput>();
	let threeJSControls = $state<OrbitControls>();
	let threeJSCamera = $state<PerspectiveCamera>();
	let selectedDepthModel = $state<DepthModelOption>(DEPTH_MODEL_OPTIONS[0]);
	let displacementScale = $state(0.8);
	let renderWebCamPreview = $state(false);

	$effect(() => {
		if (!fileList?.length || !previewImageElem) {
			previewImageSrcURI = undefined;
			return;
		}
		const objectURL = URL.createObjectURL(fileList[0]);

		previewImageSrcURI = objectURL;
		previewImageElem.onload = async () => {
			const results = await runDepthEstimation(objectURL, selectedDepthModel);
			depthEstimationResults = Array.isArray(results) ? results[0] : results;
			URL.revokeObjectURL(objectURL);
		};
	});
</script>

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

			<Toggle bind:checked={renderWebCamPreview}>Show Webcam / Face Detection</Toggle>
		</div>

		<!-- Actual file selector -->
		<Fileupload class="grow" bind:files={fileList} clearable />
	</div>
{/snippet}

<div class="fixed top-0 left-0 flex h-screen w-screen flex-col flex-wrap">
	{@render InputsAndConfig()}
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
	/>

	<!-- Input image preview -->
	<img bind:this={previewImageElem} alt="Input preview" src={previewImageSrcURI} class="hidden" />

	{#if depthEstimationResults && previewImageElem}
		<ThreeRenderer
			depthMap={depthEstimationResults}
			image={previewImageElem}
			bind:controls={threeJSControls}
			bind:camera={threeJSCamera}
			bind:displacementScale
		/>
	{/if}
</div>
