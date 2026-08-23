<script lang="ts" module>
	export type OrientationData = Pick<
		DeviceOrientationEvent,
		'absolute' | 'alpha' | 'beta' | 'gamma'
	>;
	export type MotionData = Pick<
		DeviceMotionEvent,
		'acceleration' | 'accelerationIncludingGravity' | 'interval' | 'rotationRate'
	>;
</script>

<script lang="ts" generics="WebAPIType extends 'deviceorientation' | 'devicemotion'">
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

	let {
		enabled = $bindable(true),
		isListening = $bindable(false),
		visualize = false,
		lastEvent = $bindable(undefined),
		webAPI,
		threeInputs
	}: {
		enabled?: boolean;
		visualize?: boolean;
		lastEvent?: WebAPIType extends 'deviceorientation' ? DeviceOrientationEvent : DeviceMotionEvent;
		isListening?: boolean;
		webAPI: WebAPIType;
		threeInputs?: { camera?: THREE.PerspectiveCamera; controls?: OrbitControls };
	} = $props();

	let needsPermission = $state(false);
	let mounted = $state(false);

	// Reusable math objects
	const rawDeviceQuaternion = new THREE.Quaternion();
	const finalDeviceQuaternion = new THREE.Quaternion();
	const initialOffsetQuaternion = new THREE.Quaternion();
	const forwardVector = new THREE.Vector3();
	const euler = new THREE.Euler();
	const q0 = new THREE.Quaternion();
	const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
	const zee = new THREE.Vector3(0, 0, 1);

	// Flag to track baseline alignment / initial orientation
	let isBaseSet = $state(false);

	// Call this whenever you want to re-center the view in front of the user
	export function recalibrate() {
		isBaseSet = false;
	}

	let currentValue = $derived.by(() => {
		if (!lastEvent) return { alpha: 0, beta: 0, gamma: 0 };
		if (webAPI === 'deviceorientation') {
			const evt = lastEvent as DeviceOrientationEvent;
			return { alpha: evt.alpha ?? 0, beta: evt.beta ?? 0, gamma: evt.gamma ?? 0 };
		} else {
			const evt = lastEvent as DeviceMotionEvent;
			const r = evt.rotationRate;
			return { alpha: r?.alpha ?? 0, beta: r?.beta ?? 0, gamma: r?.gamma ?? 0 };
		}
	});

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	async function startListening(_evt?: Event) {
		if (isListening) return;
		const WebEventAPI = webAPI === 'devicemotion' ? DeviceMotionEvent : DeviceOrientationEvent;

		if (WebEventAPI && 'requestPermission' in WebEventAPI) {
			try {
				const permissionState = await (
					WebEventAPI.requestPermission as () => Promise<'granted' | 'denied'>
				)();
				if (permissionState !== 'granted') {
					needsPermission = true;
					return;
				}
			} catch (error) {
				alert(`Could not subscribe to gyro events: ${error}`);
				return;
			}
		}

		if (webAPI === 'devicemotion') {
			window.addEventListener('devicemotion', handleMotionEvent);
		} else {
			window.addEventListener('deviceorientation', handleOrientationEvent);
		}
		isListening = true;
		needsPermission = false;
	}

	function stopListening() {
		if (!isListening) return;
		if (webAPI === 'devicemotion') {
			window.removeEventListener('devicemotion', handleMotionEvent);
		} else {
			window.removeEventListener('deviceorientation', handleOrientationEvent);
		}
		isListening = false;
		isBaseSet = false;
	}

	function handleMotionEvent(event: DeviceMotionEvent) {
		if (webAPI !== 'devicemotion') return;
		(lastEvent as DeviceMotionEvent) = event;

		// This is a noop for now; translating this into camera movement is much
		// trickier and would require a bunch of state tracking to compute deltas
		// (and likely wouldn't work that well)
	}

	function handleOrientationEvent(event: DeviceOrientationEvent) {
		if (webAPI !== 'deviceorientation') return;
		// Re-assigning lastEvent triggers Svelte 5 reactivity directly
		(lastEvent as DeviceOrientationEvent) = event;
	}

	$effect(() => {
		if (webAPI !== 'deviceorientation' || !lastEvent) return;
		if (!threeInputs?.camera || !threeInputs?.controls) return;

		const evt = lastEvent as DeviceOrientationEvent;
		if (evt.alpha === null || evt.beta === null || evt.gamma === null) return;

		const camera = threeInputs.camera;
		const controls = threeInputs.controls;

		// 1. Calculate raw W3C device quaternion
		const alpha = THREE.MathUtils.degToRad(evt.alpha);
		const beta = THREE.MathUtils.degToRad(evt.beta);
		const gamma = THREE.MathUtils.degToRad(evt.gamma);
		const orient = THREE.MathUtils.degToRad(window.screen?.orientation?.angle || 0);

		euler.set(beta, alpha, -gamma, 'YXZ');
		rawDeviceQuaternion.setFromEuler(euler);
		rawDeviceQuaternion.multiply(q1);
		rawDeviceQuaternion.multiply(q0.setFromAxisAngle(zee, -orient));

		// Compute initial offset on the very first frame
		if (!isBaseSet) {
			// Get current camera facing vector towards controls.target
			const currentLookDir = new THREE.Vector3()
				.subVectors(controls.target, camera.position)
				.normalize();

			// Get initial raw forward vector from phone
			const initialPhoneDir = new THREE.Vector3(0, 0, -1).applyQuaternion(rawDeviceQuaternion);

			// Compute rotation difference required to align phone forward vector with camera view
			initialOffsetQuaternion.setFromUnitVectors(initialPhoneDir, currentLookDir);
			isBaseSet = true;
		}

		// Apply baseline offset to raw orientation
		finalDeviceQuaternion.copy(initialOffsetQuaternion).multiply(rawDeviceQuaternion);

		// Calculate forward look vector relative to the re-centered origin
		forwardVector.set(0, 0, -1).applyQuaternion(finalDeviceQuaternion);

		// Update controls.target
		const distance = camera.position.distanceTo(controls.target);
		controls.target.copy(camera.position).addScaledVector(forwardVector, distance);

		// Must be called to sync
		controls.update();
	});

	onMount(() => {
		mounted = true;
		const WebEventAPI = webAPI === 'devicemotion' ? DeviceMotionEvent : DeviceOrientationEvent;
		if (WebEventAPI && 'requestPermission' in WebEventAPI) {
			needsPermission = true;
		}

		return () => {
			mounted = false;
			stopListening();
		};
	});

	$effect(() => {
		if (enabled && mounted && !needsPermission) {
			startListening();
		} else {
			stopListening();
		}
	});
</script>

{#if enabled}
	<div class="flex flex-col items-center gap-4 p-4">
		{#if needsPermission}
			<button
				onclick={startListening}
				class="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700"
			>
				Enable Gyroscope Sensors
			</button>
		{:else}
			{#if visualize}
				{@const translatedAxis = {
					x: currentValue.beta,
					y: currentValue.alpha,
					z: currentValue.gamma
				}}
				<div
					class="fixed bottom-0 left-1 flex size-28 items-center justify-center rounded-full border-4 border-slate-300 bg-slate-100 shadow-inner perspective-[1000px]"
				>
					<div
						class="relative h-24 w-24 transition-transform duration-75 ease-out"
						style="
                            transform:
                                rotateX({translatedAxis.x}deg)
                                rotateY({translatedAxis.y}deg)
                                rotateZ({translatedAxis.z}deg);
                        "
					>
						<div class="absolute inset-0 border-2 border-red-500 bg-red-500/20"></div>
						<div
							class="absolute inset-0 transform-[rotateX(90deg)] border-2 border-blue-500 bg-blue-500/20"
						></div>
						<div
							class="absolute inset-0 transform-[rotateY(90deg)] border-2 border-green-500 bg-green-500/20"
						></div>
					</div>

					<div class="absolute bottom-4 text-center font-mono text-[6px] text-slate-500">
						X / beta: {translatedAxis.x.toFixed(1)}°<br />
						Y / alpha: {translatedAxis.y.toFixed(1)}°<br />
						Z / gamma: {translatedAxis.z.toFixed(1)}°
					</div>
				</div>
			{/if}
		{/if}
	</div>
{/if}
