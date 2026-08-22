<script lang="ts">
	import { runDepthEstimation } from '$lib/processing';
	import type { DepthEstimationOutput } from '@huggingface/transformers';
	import { Fileupload } from 'flowbite-svelte';
	import FaceDetector from '../components/FaceDetector.svelte';
	import ThreeRenderer from '../components/ThreeRenderer.svelte';
	let fileList = $state<FileList>();
	let previewImageSrcURI = $state<string>();
	let previewImageElem = $state<HTMLImageElement>();
	let depthEstimationResults = $state<DepthEstimationOutput>();

	$effect(() => {
		if (!fileList?.length || !previewImageElem) {
			previewImageSrcURI = undefined;
			return;
		}
		const objectURL = URL.createObjectURL(fileList[0]);

		previewImageSrcURI = objectURL;
		previewImageElem.onload = async () => {
			const results = await runDepthEstimation(objectURL);
			depthEstimationResults = Array.isArray(results) ? results[0] : results;
			URL.revokeObjectURL(objectURL);
		};
	});
</script>

<FaceDetector />

<Fileupload bind:files={fileList} clearable />

<!-- Input image preview -->
<img
	bind:this={previewImageElem}
	alt="Input preview"
	src={previewImageSrcURI}
	class:hidden={!previewImageSrcURI}
/>

{#if depthEstimationResults && previewImageElem}
	<ThreeRenderer depthMap={depthEstimationResults} image={previewImageElem} />
{/if}
