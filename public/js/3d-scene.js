/* ═════════════════════════════════════════════════════════════════════════════
   DISHA 8.2 — 3D Scene Engine (Premium)
   Foreground Three.js visualization: floating nodes, glowing transaction paths,
   trust score rings. Renders on transparent canvas over HTML.
   ═════════════════════════════════════════════════════════════════════════════ */

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
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 2.5, 7);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x05070b, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0x10b981, 2);
    keyLight.position.set(3, 6, 4);
    keyLight.castShadow = true;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x4f46e5, 1.2);
    fillLight.position.set(-3, 2, -2);
    this.scene.add(fillLight);

    const rimLight = new THREE.PointLight(0x10b981, 1.5);
    rimLight.position.set(0, 5, -4);
    this.scene.add(rimLight);

    const backLight = new THREE.PointLight(0x4f46e5, 0.8);
    backLight.position.set(-4, 2, 4);
    this.scene.add(backLight);

    this.buildNodes();
    this.buildPaths();
    this.buildRings();

    this.animate();
  }

  buildNodes() {
    const geometry = new THREE.IcosahedronGeometry(0.26, 3);
    const material = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 0.6,
      metalness: 0.45,
      roughness: 0.15
    });

    const positions = [
      { x: -1.8, y: 0.9, z: -1 },
      { x: 1.8, y: -0.4, z: -1 },
      { x: -1.0, y: -1.3, z: 0 },
      { x: 1.0, y: 1.1, z: 0 },
      { x: 0, y: 2.1, z: -1.4 },
      { x: -1.6, y: -0.9, z: 1.0 },
      { x: 1.6, y: -0.2, z: 0.8 }
    ];

    positions.forEach((pos, i) => {
      const mesh = new THREE.Mesh(geometry, material.clone());
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.userData = {
        index: i,
        basePos: { x: pos.x, y: pos.y, z: pos.z },
        scale: 1,
        active: false,
        pulseOffset: i * 0.8
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
        opacity: 0.25
      });
      const line = new THREE.Line(geometry, material);
      this.scene.add(line);
      return { line, start, end, opacity: 0.25, targetOpacity: 0.25 };
    });
  }

  buildRings() {
    const ringGeo = new THREE.RingGeometry(0.2, 0.3, 32);
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
        maxScale: 1.8 + i * 0.7,
        active: false,
        delay: i * 0.75
      };
      this.scene.add(ring);
      this.rings.push(ring);
    }
  }

  setState(state) {
    this.state = state;
    if (state === 'idle') {
      this.nodes.forEach((node) => {
        node.userData.active = false;
        node.userData.scale = 1;
      });
      this.paths.forEach(p => {
        p.targetOpacity = 0.25;
        p.material.opacity = 0.25;
      });
      this.rings.forEach(r => {
        r.userData.active = false;
        r.material.opacity = 0;
      });
    } else if (state === 'scanning') {
      this.nodes.forEach((node) => {
        node.userData.active = true;
        node.userData.scale = 1.15;
      });
    } else if (state === 'verified') {
      this.nodes.forEach((node) => {
        node.userData.active = true;
        node.userData.scale = 1.35;
      });
      this.paths.forEach(p => {
        p.targetOpacity = 0.85;
      });
    } else if (state === 'settled') {
      this.nodes.forEach((node) => {
        node.userData.active = true;
        node.userData.scale = 1.6;
        node.material.emissiveIntensity = 2;
      });
      this.rings.forEach((ring, i) => {
        ring.userData.active = true;
        ring.userData.maxScale = 2.2 + i * 0.8;
        ring.userData.delay = i * 0.35;
      });
    }
  }

  triggerSettle(utr, amount) {
    this.setState('settled');
    const targetPos = new THREE.Vector3(0, 1.2, 4.5);
    this.animateCamera(targetPos, new THREE.Vector3(0, 0, 0), 1.6);
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
        const pulse = Math.sin(this.time * 2.5 + data.pulseOffset) * 0.08 + 1;
        node.scale.setScalar(data.scale * pulse);
        node.material.emissiveIntensity = 0.6 + Math.sin(this.time * 3 + i) * 0.4;
        node.position.y = data.basePos.y + Math.sin(this.time * 2 + i) * 0.04;
        node.position.z = data.basePos.z + Math.sin(this.time * 1.5 + i) * 0.04;
        node.rotation.y += 0.012;
        node.rotation.x += 0.005;
      } else {
        node.scale.setScalar(1 + Math.sin(this.time * 2 + i) * 0.015);
        node.position.y = data.basePos.y;
        node.position.z = data.basePos.z;
        node.material.emissiveIntensity = 0.3;
      }
    });

    this.paths.forEach((p, i) => {
      if (this.state === 'scanning' || this.state === 'verified' || this.state === 'settled') {
        p.targetOpacity = 0.8;
        const glow = Math.sin(this.time * 4 + i) * 0.3 + 0.5;
        p.material.opacity = THREE.MathUtils.lerp(p.material.opacity, p.targetOpacity, 0.06);
        p.material.color.setHex(0x10b981);
      } else {
        p.material.opacity = THREE.MathUtils.lerp(p.material.opacity, 0.25, 0.05);
      }
    });

    this.rings.forEach((ring, i) => {
      const data = ring.userData;
      if (data.active) {
        data.scale += 0.035;
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
