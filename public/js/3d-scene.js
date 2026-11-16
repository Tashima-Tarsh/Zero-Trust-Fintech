/* ══════════════════════════════════════════════════════════════════════════════
   DISHA 8.2 — 3D Scene Engine
   Foreground Three.js visualization: floating payment nodes, trust score rings,
   glowing transaction paths. Renders on transparent canvas over HTML.
   ══════════════════════════════════════════════════════════════════════════════ */

class Disha3DScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.nodes = [];
    this.paths = [];
    this.rings = [];
    this.state = 'idle'; // idle, scanning, verifying, settled
    this.animationId = null;
    this.time = 0;

    this.init();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  init() {
    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 2, 6);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x05070b, 0); // transparent background

    // Ambient light
    const ambient = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(ambient);

    // Key light
    const keyLight = new THREE.DirectionalLight(0x10b981, 1.5);
    keyLight.position.set(3, 5, 4);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x6366f1, 0.8);
    fillLight.position.set(-3, 2, -2);
    this.scene.add(fillLight);

    // Build scene elements
    this.buildNodes();
    this.buildPaths();
    this.buildRings();

    // Start render loop
    this.animate();
  }

  buildNodes() {
    const geometry = new THREE.IcosahedronGeometry(0.25, 2);
    const material = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 0.5,
      metalness: 0.4,
      roughness: 0.2
    });

    const positions = [
      { x: -1.5, y: 0.8, z: -1 },
      { x: 1.5, y: -0.5, z: -1 },
      { x: -0.8, y: -1.2, z: 0 },
      { x: 0.8, y: 1.0, z: 0 },
      { x: 0, y: 2.0, z: -1.5 },
      { x: -1.5, y: -0.8, z: 1 }
    ];

    positions.forEach((pos, i) => {
      const mesh = new THREE.Mesh(geometry, material.clone());
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.userData = {
        index: i,
        basePos: { x: pos.x, y: pos.y, z: pos.z },
        scale: 1,
        active: false,
        pulseOffset: i * 0.7
      };
      this.scene.add(mesh);
      this.nodes.push(mesh);
    });
  }

  buildPaths() {
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 3], [2, 5]
    ];

    this.paths = connections.map(([i, j]) => {
      const start = this.nodes[i].userData.basePos;
      const end = this.nodes[j].userData.basePos;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(start.x, start.y, start.z),
        new THREE.Vector3(end.x, end.y, end.z)
      ]);
      const material = new THREE.LineBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.3
      });
      const line = new THREE.Line(geometry, material);
      this.scene.add(line);
      return { line, start, end, opacity: 0.3, targetOpacity: 0.3 };
    });
  }

  buildRings() {
    const ringGeo = new THREE.RingGeometry(0.2, 0.28, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide
    });

    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(ringGeo, ringMat.clone());
      ring.position.set(0, 0, 0);
      ring.userData = {
        scale: 0,
        opacity: 0,
        maxScale: 1.5 + i * 0.5,
        active: false,
        delay: i * 0.4
      };
      this.scene.add(ring);
      this.rings.push(ring);
    }
  }

  setState(state) {
    this.state = state;
    if (state === 'idle') {
      this.nodes.forEach((node, i) => {
        node.userData.active = false;
        node.userData.scale = 1;
      });
      this.paths.forEach(p => {
        p.targetOpacity = 0.3;
        p.material.opacity = 0.3;
      });
      this.rings.forEach(r => {
        r.userData.active = false;
        r.material.opacity = 0;
      });
    } else if (state === 'scanning') {
      this.nodes.forEach((node, i) => {
        node.userData.active = true;
        node.userData.scale = 1.1;
      });
    } else if (state === 'verified') {
      this.nodes.forEach((node, i) => {
        node.userData.active = true;
        node.userData.scale = 1.3;
      });
      this.paths.forEach(p => {
        p.targetOpacity = 0.8;
      });
    } else if (state === 'settled') {
      this.nodes.forEach(node => {
        node.userData.active = true;
        node.userData.scale = 1.5;
        node.material.emissiveIntensity = 1.5;
      });
      this.rings.forEach((ring, i) => {
        ring.userData.active = true;
        ring.userData.maxScale = 2 + i * 0.8;
        ring.userData.delay = i * 0.3;
      });
    }
  }

  triggerSettle(utr, amount) {
    this.setState('settled');
    const targetPos = new THREE.Vector3(0, 1, 4);
    this.animateCamera(targetPos, new THREE.Vector3(0, 0, 0), 1.5);
  }

  animateCamera(targetPos, targetLook, duration) {
    const startPos = this.camera.position.clone();
    const start = performance.now();

    const animate = (time) => {
      const elapsed = (time - start) / duration;
      if (elapsed >= 1) {
        this.camera.position.copy(targetPos);
        this.camera.lookAt(targetLook);
        return;
      }
      const t = elapsed * elapsed * (3 - 2 * elapsed);
      this.camera.position.lerpVectors(startPos, targetPos, t);
      this.camera.lookAt(0, 0, 0);
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  animate() {
    this.animationId = requestAnimationFrame(() => this.animate());
    this.time += 0.01;

    this.nodes.forEach((node, i) => {
      const data = node.userData;
      if (data.active) {
        const pulse = Math.sin(this.time * 3 + data.pulseOffset) * 0.1 + 1;
        node.scale.setScalar(data.scale * pulse);
        node.material.emissiveIntensity = 0.5 + Math.sin(this.time * 4 + i) * 0.3;
        node.position.y = data.basePos.y + Math.sin(this.time * 2 + i) * 0.05;
        node.position.z = data.basePos.z + Math.sin(this.time * 1.5 + i) * 0.05;
        node.rotation.y += 0.01;
        node.rotation.x += 0.005;
      } else {
        node.scale.setScalar(1 + Math.sin(this.time * 2 + i) * 0.02);
        node.position.y = data.basePos.y;
        node.position.z = data.basePos.z;
        node.material.emissiveIntensity = 0.3;
      }
    });

    this.paths.forEach((p, i) => {
      if (p.line.material.opacity !== undefined) {
        if (this.state === 'scanning' || this.state === 'verified' || this.state === 'settled') {
          p.targetOpacity = 0.8;
          const glow = Math.sin(this.time * 4 + i) * 0.3 + 0.5;
          p.material.opacity = THREE.MathUtils.lerp(p.material.opacity, p.targetOpacity, 0.05);
          p.material.color.setHex(0x10b981);
        } else {
          p.material.opacity = THREE.MathUtils.lerp(p.material.opacity, 0.3, 0.05);
        }
      }
    });

    this.rings.forEach((ring, i) => {
      const data = ring.userData;
      if (data.active) {
        data.scale += 0.04;
        data.opacity = Math.max(0, 1 - data.scale / data.maxScale);
        ring.scale.setScalar(data.scale);
        ring.material.opacity = data.opacity;
        if (data.scale >= data.maxScale) {
          data.scale = 0;
          data.opacity = 0;
          ring.material.opacity = 0;
        }
      } else {
        ring.scale.setScalar(0);
        ring.material.opacity = 0;
      }
    });

    this.renderer.render(this.scene, this.camera);
  }

  start() {
    if (!this.animationId) {
      this.animate();
    }
  }
}
