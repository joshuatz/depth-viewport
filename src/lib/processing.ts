import { env, pipeline, RawImage, type DepthEstimationOutput } from '@huggingface/transformers';
import type { ImagePipelineInputs } from '../../node_modules/@huggingface/transformers/types/pipelines/_base';

export const DEPTH_MODEL_OPTIONS = [
	{
		repo: 'onnx-community/depth-anything-v2-small',
		model_file_name: 'model',
		subfolder: 'onnx'
	}
] as const;
export type DepthModelOption = (typeof DEPTH_MODEL_OPTIONS)[number];

export async function runDepthEstimation(
	imageInput: ImagePipelineInputs,
	model: DepthModelOption
): Promise<DepthEstimationOutput> {
	// Force WebGPU execution
	if (env.backends.onnx.wasm) {
		env.backends.onnx.wasm.numThreads = 1;
	}

	const depthEstimator = await pipeline('depth-estimation', model.repo, {
		device: 'webgpu',
		...model
	});

	// Run depth prediction locally in the browser
	const result = await depthEstimator(imageInput);

	// 'result.depth' contains the processed RawImage depth map
	// 'result.predicted_depth' contains the raw tensor output
	return Array.isArray(result) ? result[0] : result;
}

export type DepthExtractionResults =
	| {
			source: 'embedded';
			depthMap: RawImage;
	  }
	| {
			source: 'ml';
			depthMap: RawImage;
			mlOutput: DepthEstimationOutput;
	  };

export async function runDepthExtraction({
	imageBytes,
	model,
	mlPipelineInput
}: {
	imageBytes: ArrayBuffer;
	model: DepthModelOption;
	mlPipelineInput: ImagePipelineInputs;
}): Promise<DepthExtractionResults> {
	// Try to auto-extract embedded depth maps (e.g. from certain smartphones)
	const jpegSegments: number[] = [];
	const buffer = new Uint8Array(imageBytes);
	// Scan the binary buffer for JPEG magic markers (0xFF 0xD8)
	for (let i = 0; i < buffer.length - 1; i++) {
		if (buffer[i] === 0xff && buffer[i + 1] === 0xd8) {
			jpegSegments.push(i);
		}
	}

	// If more than one JPEG block exists, the later ones contain depth metadata
	if (jpegSegments.length > 1) {
		const depthStart = jpegSegments[jpegSegments.length - 1];
		const depthBytes = buffer.subarray(depthStart);

		// Convert the raw extracted bytes into a viewable browser blob
		const blob = new Blob([depthBytes], { type: 'image/jpeg' });

		return {
			source: 'embedded',
			depthMap: await RawImage.fromBlob(blob)
		};
	} else {
		console.log('No secondary embedded JPEG segment found.');
	}
	// fallback to ML extraction (e.g. depth-anything)
	const mlOutput = await runDepthEstimation(mlPipelineInput, model);
	return {
		source: 'ml',
		depthMap: mlOutput.depth,
		mlOutput
	};
}
