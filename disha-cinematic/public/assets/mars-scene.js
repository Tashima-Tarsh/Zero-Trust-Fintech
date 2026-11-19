/* DISHA 8.2 — Mars Checkout Background Scene
   Procedural Three.js — no external assets, ~8KB gzipped */
(() => {
  'use strict';

  const canvas = document.getElementById('mars-bg-canvas');
  if (!canvas) return;

  // ─── Renderer ──────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // ─── Scene & Camera ────────────────────────────────────────
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 0, 4.8);

  // ─── Mars Sphere (procedural) ──────────────────────────────
  const marsRadius = 1.6;
  const marsGeo = new THREE.IcosahedronGeometry(marsRadius, 5); // ~10k triangles

  // Procedural noise for displacement
  const posAttr = marsGeo.getAttribute('position');
  const displacement = new Float32Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    // Simple fbm noise approximation
    let n = 0;
    let amp = 0.02;
    let freq = 1.5;
    for (let o = 0; o < 4; o++) {
      const nx = x * freq + o * 17.3;
      const ny = y * freq + o * 29.1;
      const nz = z * freq + o * 41.7;
      n += amp * Math.sin(nx * 3.1 + ny * 2.7 + nz * 4.3) *
              Math.cos(nx * 2.9 + ny * 3.3 + nz * 1.7);
      amp *= 0.5;
      freq *= 2.1;
    }
    displacement[i] = n;
  }
  marsGeo.setAttribute('displacement', new THREE.BufferAttribute(displacement, 1));
  marsGeo.computeVertexNormals();

  const marsMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xe86c2a),      // Mars base
    roughness: 0.92,
    metalness: 0.02,
    flatShading: false,
    onBeforeCompile: (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uDisplacementScale = { value: 0.045 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <begin_vertex>', `
          float disp = attributeDisplacement * uDisplacementScale *
            (1.0 + 0.3 * sin(uTime * 0.05 + position.x * 2.0 + position.z * 3.0));
          vec3 transformed = position + normal * disp;
        `)
        .replace('void main()', `
          uniform float uTime;
          uniform float uDisplacementScale;
          attribute float attributeDisplacement;
          void main()
        `);
    }
  });

  const mars = new THREE.Mesh(marsGeo, marsMaterial);
  mars.name = 'Mars';
  scene.add(mars);

  // ─── Atmosphere Shell (Fresnel glow) ───────────────────────
  const atmoGeo = new THREE.SphereGeometry(marsRadius * 1.08, 48, 48);
  const atmoMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColorInner: { value: new THREE.Color(0xff8844) },
      uColorOuter: { value: new THREE.Color(0xff5522) }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColorInner;
      uniform vec3 uColorOuter;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.5);
        float pulse = 0.85 + 0.15 * sin(uTime * 0.3 + vWorldPos.y * 0.5);
        vec3 color = mix(uColorOuter, uColorInner, fresnel) * pulse;
        float alpha = fresnel * 0.35 * pulse;
        gl_FragColor = vec4(color, alpha);
      }
    `
  });
  const atmosphere = new THREE.Mesh(atmoGeo, atmoMaterial);
  scene.add(atmosphere);

  // ─── Dust Haze (additive particles near surface) ───────────
  const dustCount = 800;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(dustCount * 3);
  const dustSize = new Float32Array(dustCount);
  const dustOpacity = new Float32Array(dustCount);
  const dustSpeed = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    const r = marsRadius * (1.01 + Math.random() * 0.12);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    dustPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    dustPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    dustPos[i * 3 + 2] = r * Math.cos(phi);
    dustSize[i] = 0.015 + Math.random() * 0.025;
    dustOpacity[i] = 0.15 + Math.random() * 0.25;
    dustSpeed[i] = 0.00008 + Math.random() * 0.0002;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('aSize', new THREE.BufferAttribute(dustSize, 1));
  dustGeo.setAttribute('aOpacity', new THREE.BufferAttribute(dustOpacity, 1));
  dustGeo.setAttribute('aSpeed', new THREE.BufferAttribute(dustSpeed, 1));

  const dustMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aSize;
      attribute float aOpacity;
      attribute float aSpeed;
      varying float vOpacity;
      uniform float uTime;
      void main() {
        vOpacity = aOpacity;
        vec3 pos = position;
        pos.y += sin(uTime * aSpeed * 1000.0 + position.x * 5.0) * 0.003;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = aSize * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vOpacity;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float alpha = (1.0 - smoothstep(0.0, 0.5, d)) * vOpacity;
        gl_FragColor = vec4(1.0, 0.65, 0.35, alpha);
      }
    `
  });
  const dust = new THREE.Points(dustGeo, dustMaterial);
  scene.add(dust);

  // ─── Starfield ─────────────────────────────────────────────
  const starCount = 2500;
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(starCount * 3);
  const starSize = new Float32Array(starCount);
  const starBrightness = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const r = 40 + Math.random() * 20;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPos[i * 3 + 2] = r * Math.cos(phi);
    starSize[i] = 0.06 + Math.random() * 0.12;
    starBrightness[i] = 0.4 + Math.random() * 0.6;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));
  starGeo.setAttribute('aBrightness', new THREE.BufferAttribute(starBrightness, 1));

  const starMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aSize;
      attribute float aBrightness;
      varying float vBrightness;
      void main() {
        vBrightness = aBrightness;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (400.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vBrightness;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float alpha = (1.0 - smoothstep(0.0, 0.5, d)) * vBrightness;
        gl_FragColor = vec4(1.0, 0.98, 0.92, alpha);
      }
    `
  });
  const stars = new THREE.Points(starGeo, starMaterial);
  scene.add(stars);

  // ─── Lighting ──────────────────────────────────────────────
  const sunDir = new THREE.Vector3(1, 0.3, -1).normalize();
  const sunLight = new THREE.DirectionalLight(0xfff5e0, 1.1);
  sunLight.position.copy(sunDir).multiplyScalar(10);
  scene.add(sunLight);

  const ambient = new THREE.AmbientLight(0x332218, 0.4);
  scene.add(ambient);

  // ─── Animation Loop ────────────────────────────────────────
  let time = 0;
  let targetX = 0, targetY = 0;
  const maxParallax = 0.25;

  function animate() {
    requestAnimationFrame(animate);
    time += 16.67; // ~60fps ms

    // Uniforms
    marsMaterial.uniforms.uTime.value = time;
    atmoMaterial.uniforms.uTime.value = time;
    dustMaterial.uniforms.uTime.value = time;

    // Slow mars rotation
    mars.rotation.y += 0.00004;
    atmosphere.rotation.y += 0.00003;
    dust.rotation.y += 0.00002;
    stars.rotation.y += 0.000005;

    // Parallax on mouse
    camera.position.x += (targetX - camera.position.x) * 0.015;
    camera.position.y += (-targetY - camera.position.y) * 0.015;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }
  animate();

  // ─── Mouse Parallax ────────────────────────────────────────
  document.addEventListener('mousemove', (e) => {
    targetX = (e.clientX / innerWidth - 0.5) * maxParallax;
    targetY = (e.clientY / innerHeight - 0.5) * maxParallax * 0.6;
  }, { passive: true });

  // ─── Resize ────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }, { passive: true });

  // ─── Visibility Optimization ───────────────────────────────
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      renderer.setAnimationLoop(null);
    } else {
      animate();
    }
  });

  // Expose for debugging
  window.__MARS_SCENE__ = { scene, camera, renderer, mars, atmosphere, dust, stars };
})();