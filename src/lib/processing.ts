import { env, pipeline } from '@huggingface/transformers';
import type { ImagePipelineInputs } from '../../node_modules/@huggingface/transformers/types/pipelines/_base';

export const DEPTH_MODEL_OPTIONS = [
	{
		repo: 'onnx-community/depth-anything-v2-small',
		model_file_name: 'model',
		subfolder: 'onnx'
	}
] as const;
export type DepthModelOption = (typeof DEPTH_MODEL_OPTIONS)[number];

export async function runDepthEstimation(imageInput: ImagePipelineInputs, model: DepthModelOption) {
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
	return result;
}
