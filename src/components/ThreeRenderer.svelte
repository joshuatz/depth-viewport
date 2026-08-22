<script lang="ts">
	/* eslint-disable svelte/no-dom-manipulating */
	import type { DepthEstimationOutput } from '@huggingface/transformers';
	import * as THREE from 'three';
	import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

	let {
		depthMap,
		image
	}: {
		depthMap: DepthEstimationOutput | undefined;
		image: HTMLImageElement | undefined;
	} = $props();

	let containerElem = $state<HTMLDivElement>();

	$effect(() => {
		if (!depthMap || !image || !containerElem) return;

		containerElem.innerHTML = '';

		const scene = new THREE.Scene();

		// PerspectiveCamera parameters:
		// 75: Field of view in degrees (standard balanced FOV for 3D viewers).
		// 1: Aspect ratio matching the square 400x400 canvas.
		// 0.1 & 1000: Near and far clipping planes (objects closer than 0.1 or farther than 1000 units won't render).
		const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);

		// Position camera 2 units along the Z-axis so a 2x2 plane centered at (0,0,0) comfortably fills the FOV.
		camera.position.z = 2;

		const renderer = new THREE.WebGLRenderer({ antialias: true });
		// Fixed dimensions for the interactive viewport in pixels.
		renderer.setSize(400, 400);
		containerElem.appendChild(renderer.domElement);

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		// Damping factor of 0.05 gives a natural, smooth drag-and-decelerate weight to mouse movement.
		controls.dampingFactor = 0.05;

		const colorTexture = new THREE.Texture(image);
		colorTexture.needsUpdate = true;

		const depthCanvas = depthMap.depth.toCanvas();
		const depthTexture = new THREE.CanvasTexture(depthCanvas);

		// PlaneGeometry parameters:
		// width = 2, height = 2: Creates a normalized square unit plane centered at (0,0,0).
		// widthSegments = 128, heightSegments = 128: Divides the plane into a 128x128 grid (16,384 quads / 32,768 triangles).
		// A flat plane only has 4 vertices; high segmentation is required so individual vertices can be pushed
		// outward by the displacement map to form detailed 3D relief without visible jaggedness.
		const geometry = new THREE.PlaneGeometry(2, 2, 128, 128);

		const material = new THREE.MeshStandardMaterial({
			map: colorTexture,
			displacementMap: depthTexture,
			// Controls the depth intensity in world units.
			// 0.3 means white pixels in the depth map displace vertices by a maximum of 0.3 units forward.
			// Keeping it relative (~15% of the 2.0 plane width) creates subtle depth without severe stretching.
			displacementScale: 0.3
		});

		const mesh = new THREE.Mesh(geometry, material);
		scene.add(mesh);

		// Direct key light from the camera position (0,0,2) with intensity 2 to cast realistic shadows over extruded surfaces.
		const light = new THREE.DirectionalLight(0xffffff, 2);
		light.position.set(0, 0, 2);
		scene.add(light);

		// Low-intensity soft overall light (0.5) so unlit backside slopes remain visible rather than pitch black.
		scene.add(new THREE.AmbientLight(0xffffff, 0.5));

		let frameId: number;
		const animate = () => {
			frameId = requestAnimationFrame(animate);
			controls.update();
			renderer.render(scene, camera);
		};
		animate();

		return () => {
			cancelAnimationFrame(frameId);
			controls.dispose();
			renderer.dispose();
			geometry.dispose();
			material.dispose();
		};
	});
</script>

<div bind:this={containerElem}></div>
