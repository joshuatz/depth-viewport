<script lang="ts">
	/* eslint-disable svelte/no-dom-manipulating */
	import type { RawImage } from '@huggingface/transformers';
	import { useResizeObserver, watch } from 'runed';
	import * as THREE from 'three';
	import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

	let {
		depthMap,
		image,
		camera = $bindable(),
		renderer = $bindable(),
		controls = $bindable(),
		fullscreen = $bindable(false),
		displacementScale = $bindable(0.8)
	}: {
		depthMap: RawImage | undefined;
		image: HTMLImageElement | undefined;
		renderer?: THREE.WebGLRenderer;
		controls?: OrbitControls;
		camera?: THREE.PerspectiveCamera;
		fullscreen?: boolean;
		/**
		 * Controls the depth intensity in world units.
		 */
		displacementScale?: number;
	} = $props();

	let containerElem = $state<HTMLDivElement>();

	watch(
		() => ({ depthMap, image, containerElem, displacementScale }),
		() => {
			if (!depthMap || !image || !containerElem) return;

			containerElem.innerHTML = '';

			const scene = new THREE.Scene();

			// PerspectiveCamera parameters:
			// 75: Field of view in degrees (standard balanced FOV for 3D viewers).
			// 1: Aspect ratio matching the square 400x400 canvas.
			// 0.1 & 1000: Near and far clipping planes (objects closer than 0.1 or farther than 1000 units won't render).
			camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);

			// Position camera 2 units along the Z-axis so a 2x2 plane centered at (0,0,0) comfortably fills the FOV.
			camera.position.z = 2;

			renderer = new THREE.WebGLRenderer({ antialias: true });
			// Fixed dimensions for the interactive viewport in pixels.
			renderer.setSize(400, 400);
			containerElem.appendChild(renderer.domElement);

			controls = new OrbitControls(camera, renderer.domElement);
			controls.enableDamping = true;
			// Damping factor of 0.05 gives a natural, smooth drag-and-decelerate weight to mouse movement.
			controls.dampingFactor = 0.05;

			const colorTexture = new THREE.Texture(image);
			colorTexture.needsUpdate = true;

			const depthCanvas = depthMap.toCanvas();
			const depthTexture = new THREE.CanvasTexture(depthCanvas);

			// PlaneGeometry parameters:
			// width/height are scaled to match the image's natural aspect ratio so the texture isn't stretched.
			// widthSegments = 128, heightSegments = 128: Divides the plane into a 128x128 grid (16,384 quads / 32,768 triangles).
			// A flat plane only has 4 vertices; high segmentation is required so individual vertices can be pushed
			// outward by the displacement map to form detailed 3D relief without visible jaggedness.
			const aspect = image.naturalWidth / image.naturalHeight;
			const planeWidth = 2;
			const planeHeight = 2 / aspect;
			const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, 128, 128);

			const material = new THREE.ShaderMaterial({
				uniforms: {
					colorTexture: { value: colorTexture },
					depthTexture: { value: depthTexture },
					displacementScale: { value: displacementScale },
				},
				vertexShader: `
					varying vec2 vUv;
					uniform sampler2D depthTexture;
					uniform float displacementScale;

					void main() {
						vUv = uv;
						float depth = texture2D(depthTexture, uv).r;
						vec3 newPosition = position + normal * depth * displacementScale;
						gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
					}
				`,
				fragmentShader: `
					varying vec2 vUv;
					uniform sampler2D colorTexture;

					void main() {
						gl_FragColor = texture2D(colorTexture, vUv);
					}
				`,
			});

			const mesh = new THREE.Mesh(geometry, material);
			scene.add(mesh);

			let frameId: number;
			const animate = () => {
				frameId = requestAnimationFrame(animate);
				controls!.update();
				renderer!.render(scene, camera!);
			};
			animate();

			return () => {
				cancelAnimationFrame(frameId);
				controls?.dispose();
				renderer?.dispose();
				geometry.dispose();
				material.dispose();
			};
		}
	);

	$effect(() => {
		if (fullscreen && !document.fullscreenElement) {
			containerElem?.requestFullscreen();
		} else if (document.fullscreenElement) {
			try {
				document.exitFullscreen();
			} finally {
				//
			}
		}
	});

	useResizeObserver(
		() => containerElem,
		() => {
			if (!camera || !renderer || !containerElem) {
				return;
			}
			// Update camera matrix using the container's updated dimensions
			camera.aspect = containerElem.clientWidth / containerElem.clientHeight;
			camera.updateProjectionMatrix();

			// Update renderer and account for pixel ratio limits
			renderer.setSize(containerElem.clientWidth, containerElem.clientHeight);
			renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		}
	);
</script>

<div
	bind:this={containerElem}
	ondblclick={() => (fullscreen = !fullscreen)}
	class="min-h-1 flex-1"
	role="button"
	tabindex="-1"
></div>
