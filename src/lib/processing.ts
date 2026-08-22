import { env, pipeline } from '@huggingface/transformers';
import type { ImagePipelineInputs } from '../../node_modules/@huggingface/transformers/types/pipelines/_base';

export async function runDepthEstimation(imageInput: ImagePipelineInputs) {
	// Force WebGPU execution
	if (env.backends.onnx.wasm) {
		env.backends.onnx.wasm.numThreads = 1;
	}

	// Load the Depth Anything V2 model with WebGPU acceleration
	const depthEstimator = await pipeline(
		'depth-estimation',
		'onnx-community/depth-anything-v2-small',
		{ device: 'webgpu' }
	);

	// Run depth prediction locally in the browser
	const result = await depthEstimator(imageInput);

	// 'result.depth' contains the processed RawImage depth map
	// 'result.predicted_depth' contains the raw tensor output
	return result;
}
