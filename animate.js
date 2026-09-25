// The import map in index.html locks these modules to one Three.js release.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import GUI from "https://cdn.jsdelivr.net/npm/lil-gui@0.21.0/+esm";

var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(
  90, // Cinematic, slightly compressed field of view
  window.innerWidth / window.innerHeight,
  0.1,
  85000
);
const isMobileViewport = window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
var renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
// The star shader uses this pixel ratio when it calculates point size. Keep
// the same rendering resolution on touch devices as desktop so stars retain
// their desktop brightness and definition instead of becoming sub-pixel.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
document.body.appendChild(renderer.domElement);

// Preserve the Sun's emissive values above 1.0 for the bloom threshold. The
// 8-bit target is a fallback for devices without a float color buffer.
const hasFloatColorBuffer = renderer.capabilities.isWebGL2 && renderer.extensions.has("EXT_color_buffer_float");
const renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
  type: hasFloatColorBuffer ? THREE.HalfFloatType : THREE.UnsignedByteType,
});
const composer = new EffectComposer(renderer, renderTarget);
composer.setPixelRatio(renderer.getPixelRatio());
composer.addPass(new RenderPass(scene, camera));

// The emissive Sun dominates the bright pass. The final corona mask keeps
// distant stars sharp while light can spill over nearby orbiting bodies.
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.25,
  0.55,
  0.28
);
bloomPass.bloomTintColors[0].set(1, 1, 1);
bloomPass.bloomTintColors[1].set(1, 1, 1);
bloomPass.bloomTintColors[2].set(1, 1, 1);
bloomPass.bloomTintColors[3].set(1, 1, 1);
bloomPass.bloomTintColors[4].set(1, 1, 1);
composer.addPass(bloomPass);

// This Three.js release predates OutputPass. Keep bloom outside the solar disk
// to preserve the texture, and fade its wide mips before they tint the sky.
const displayPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    bloomTexture: { value: bloomPass.renderTargetsHorizontal[0].texture },
    sunCenter: { value: new THREE.Vector2() },
    sunRadius: { value: 1 },
    resolution: { value: new THREE.Vector2() },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D bloomTexture;
    uniform vec2 sunCenter;
    uniform float sunRadius;
    uniform vec2 resolution;
    varying vec2 vUv;
    void main() {
      vec3 bloom = texture2D(bloomTexture, vUv).rgb;
      vec3 sceneColor = max(texture2D(tDiffuse, vUv).rgb - bloom, vec3(0.0));
      float distanceFromSun = length((vUv - sunCenter) * resolution) / sunRadius;
      float corona = smoothstep(0.97, 1.04, distanceFromSun) *
        (1.0 - smoothstep(1.12, 1.45, distanceFromSun));
      // Keep a restrained bloom halo around bright stars while reserving the
      // full bloom contribution for the Sun's masked corona.
      vec3 color = (sceneColor + bloom * (0.14 + 0.86 * corona)) * 0.72;
      color = clamp((color * (2.51 * color + 0.03)) /
        (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
      gl_FragColor = LinearTosRGB(vec4(color, 1.0));
    }
  `,
});
composer.addPass(displayPass);

const sunScreenCenter = new THREE.Vector3();
const sunScreenEdge = new THREE.Vector3();
const sunScreenRight = new THREE.Vector3();

function updateBloomScreenMask() {
  camera.updateMatrixWorld();
  sunScreenCenter.copy(sun.position).project(camera);
  sunScreenRight.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(BODY_RADII.sun);
  sunScreenEdge.copy(sun.position).add(sunScreenRight).project(camera);

  const width = window.innerWidth * renderer.getPixelRatio();
  const height = window.innerHeight * renderer.getPixelRatio();
  displayPass.uniforms.sunCenter.value.set(
    (sunScreenCenter.x + 1) * 0.5,
    (sunScreenCenter.y + 1) * 0.5
  );
  displayPass.uniforms.sunRadius.value = Math.max(
    Math.abs(sunScreenEdge.x - sunScreenCenter.x) * width * 0.5,
    1
  );
  displayPass.uniforms.resolution.value.set(width, height);
}


//CAMERA HELPER
// const helper = new THREE.CameraHelper( camera );
// scene.add( helper );


// Start on a low three-quarter angle so the Sun anchors the frame while the
// orbital plane recedes into depth instead of reading like a flat top-down map.
const cameraTarget = new THREE.Vector3(0, 8, 0);
camera.position.set(240, 64, -140);
camera.lookAt(cameraTarget);


const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(cameraTarget);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.screenSpacePanning = true;
controls.enableZoom = true;
controls.rotateSpeed = 0.44;
controls.enablePan = true;
//controls.minDistance = 100;
//controls.maxDistance = 500;

controls.zoomSpeed = 1.3;
controls.update();

const focusState = {
  body: null,
  startPosition: new THREE.Vector3(),
  startTarget: new THREE.Vector3(),
  direction: new THREE.Vector3(),
  distance: 0,
  elapsed: 0,
};

function focusBody(body) {
  focusState.body = body;
  focusState.startPosition.copy(camera.position);
  focusState.startTarget.copy(controls.target);
  focusState.direction.copy(camera.position).sub(controls.target);
  if (focusState.direction.lengthSq() < 0.01) focusState.direction.set(0.35, 0.65, 0.68);
  focusState.direction.normalize();
  const bodyRadius = body.geometry?.parameters?.radius ?? 1;
  focusState.distance = body === sun ? 290 : Math.max(10, bodyRadius * 18);
  focusState.elapsed = 0;
}

function updateCameraFocus(delta) {
  if (!focusState.body) return;
  const destinationTarget = focusState.body.position;
  const destinationPosition = destinationTarget.clone().addScaledVector(focusState.direction, focusState.distance);
  focusState.elapsed = Math.min(focusState.elapsed + delta / 0.9, 1);
  if (focusState.elapsed < 1) {
    const t = focusState.elapsed * focusState.elapsed * (3 - 2 * focusState.elapsed);
    controls.target.lerpVectors(focusState.startTarget, destinationTarget, t);
    camera.position.lerpVectors(focusState.startPosition, destinationPosition, t);
  } else {
    // Keep the camera centered on the moving body after the initial fly-to.
    // This makes orbital motion visible without requiring the user to drag.
    const followBlend = 1 - Math.pow(0.001, delta);
    controls.target.lerp(destinationTarget, followBlend);
    camera.position.lerp(destinationPosition, followBlend);
  }
  camera.lookAt(controls.target);
}

function stopFollowing() {
  focusState.body = null;
}


//STAGE

//LOD

//LIGHT HELPER
//const lightHelper = new THREE.DirectionalLightHelper( light, 5 );
//scene.add( lightHelper );


/*
const secondLightHelper = new THREE.DirectionalLightHelper(secondlight, 3);
scene.add(secondLightHelper);
*/
/*
//BACKGROUND
var textureLoader = new THREE.TextureLoader();
var backgroundTexture = textureLoader.load('klopp.jpg');
var backgroundPlaneGeometry = new THREE.PlaneGeometry(2, 2, 0);
var backgroundPlaneMaterial = new THREE.MeshBasicMaterial({ map: backgroundTexture });
var backgroundPlane = new THREE.Mesh(backgroundPlaneGeometry, backgroundPlaneMaterial);

// Set the position of the background plane so that it's behind all other objects
backgroundPlane.position.z = -1;
scene.add(backgroundPlane);
*/

// TEXTURES
// Planet image maps in this project use equirectangular (2:1) UVs.  Keep their
// horizontal seam wrapped and use mipmaps + anisotropic filtering so surface
// detail remains stable while the camera moves.
const textureLoader = new THREE.TextureLoader();
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

function loadColorTexture(path) {
  const texture = textureLoader.load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

function loadNormalTexture(path, repeat = new THREE.Vector2(1, 1)) {
  const texture = textureLoader.load(path);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = repeat.y === 1 ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  texture.repeat.copy(repeat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

const surfaceNormal = loadNormalTexture('planetTextures/roughtexture.jpg', new THREE.Vector2(2, 2));
const sunNormal = loadNormalTexture('planetTextures/bumpity.jpg', new THREE.Vector2(2, 1));

// Mean body radii scaled against the Sun's existing visual radius. Distances
// remain compressed for readability, but body sizes now keep real proportions.
const BODY_RADII = {
  sun: 64.913,
  mercury: 0.228,
  venus: 0.565,
  earth: 0.595,
  moon: 0.162,
  mars: 0.316,
  jupiter: 6.524,
  saturn: 5.435,
  uranus: 2.367,
  neptune: 2.297,
};

// SUN — a complete sphere gives the 2:1 solar map its intended longitude seam.
var sunGeometry = new THREE.SphereGeometry(BODY_RADII.sun, 96, 64);
const sunMaterial = new THREE.ShaderMaterial({
  uniforms: {
    time: { value: 0 },
  },
  vertexShader: `
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;
    void main() {
      vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float time;
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;

    float hash(vec3 p) {
      p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    float noise(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
            mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
        mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
            mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
    }

    float fbm(vec3 p) {
      float value = 0.0;
      float amplitude = 0.5;
      for (int octave = 0; octave < 5; octave++) {
        value += amplitude * noise(p);
        p = p * 2.03 + vec3(9.1, 4.7, 2.3);
        amplitude *= 0.5;
      }
      return value;
    }

    void main() {
      vec3 p = normalize(vWorldPosition) * 3.1;
      // Rotate the procedural surface pattern at the same deliberately slow
      // pace as the Sun's axial rotation. Mesh rotation alone is not visible
      // here because the noise is evaluated from world-space direction.
      float rotationAngle = time * 0.1365;
      mat2 rotation = mat2(cos(rotationAngle), -sin(rotationAngle),
                           sin(rotationAngle), cos(rotationAngle));
      p.xz = rotation * p.xz;
      p += vec3(time * 0.012, -time * 0.008, time * 0.01);
      float convection = fbm(p);
      float detail = fbm(p * 2.8 - vec3(3.0, 1.0, 2.0));
      float plasma = smoothstep(0.33, 0.8, convection * 0.72 + detail * 0.48);
      float flare = smoothstep(0.73, 0.98, detail + convection * 0.3);
      vec3 deepOrange = vec3(0.82, 0.055, 0.004);
      vec3 orange = vec3(1.0, 0.22, 0.008);
      vec3 gold = vec3(1.0, 0.62, 0.055);
      vec3 color = mix(deepOrange, orange, plasma);
      color = mix(color, gold, smoothstep(0.45, 0.9, convection));
      color += vec3(1.0, 0.76, 0.27) * flare * 0.72;

      vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
      float rim = pow(1.0 - max(dot(vWorldNormal, viewDirection), 0.0), 1.7);
      color += vec3(1.0, 0.16, 0.015) * rim * 0.18;
      gl_FragColor = vec4(color * 2.2, 1.0);
    }
  `,
});
var sun = new THREE.Mesh(sunGeometry, sunMaterial);
sun.position.set(0, 0, 0);
scene.add(sun);

// DISTANT STAR FIELD
// Keep stars as a deep all-sky backdrop far beyond the solar system, so camera
// pans and tilts still reveal twinkling points without placing stars near the
// planets.
const starLayers = [];
const starfieldLayers = [
  { count: 14600, radiusMin: 36000, radiusMax: 46000, sizeMin: 28, sizeMax: 70, opacity: 0.18, twinkle: 0.52 },
  { count: 16000, radiusMin: 52000, radiusMax: 66000, sizeMin: 42, sizeMax: 95, opacity: 0.25, twinkle: 0.44 },
  { count: 14000, radiusMin: 72000, radiusMax: 84000, sizeMin: 55, sizeMax: 120, opacity: 0.12, twinkle: 0.32 },
];

function createStarfieldMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      pixelRatio: { value: renderer.getPixelRatio() },
    },
    vertexShader: `
      attribute vec3 starColor;
      attribute float starSize;
      attribute float starOpacity;
      attribute float twinkleOffset;
      attribute float twinkleRate;
      attribute float twinkleAmount;
      uniform float time;
      uniform float pixelRatio;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float pulse = 0.5 + 0.5 * sin(time * twinkleRate + twinkleOffset);
        float twinkle = 1.0 - twinkleAmount * 0.45 + twinkleAmount * 0.9 * pulse;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = starSize * twinkle * pixelRatio * (120.0 / max(-mvPosition.z, 1.0));
        gl_Position = projectionMatrix * mvPosition;
        vColor = starColor;
        vAlpha = starOpacity * (0.4 + 0.6 * pulse);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float dist = length(coord);
        float alpha = smoothstep(0.5, 0.08, dist) * vAlpha;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function createSeededRandom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function sampleUniformDirection(random, target) {
  const y = random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  target.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  return target;
}

function sampleGalaxyDirection(random, target, galaxyAxis, tangentA, tangentB) {
  const angle = random() * Math.PI * 2;
  // A thin Gaussian thickness creates a broad, natural-looking galactic band.
  const gaussian = Math.sqrt(-2 * Math.log(Math.max(random(), 0.0001))) * Math.cos(random() * Math.PI * 2);
  target.copy(tangentA).multiplyScalar(Math.cos(angle))
    .addScaledVector(tangentB, Math.sin(angle))
    .addScaledVector(galaxyAxis, gaussian * 0.11)
    .normalize();
  return target;
}

function createDistantStarField(layer) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(layer.count * 3);
  const colors = new Float32Array(layer.count * 3);
  const sizes = new Float32Array(layer.count);
  const opacities = new Float32Array(layer.count);
  const twinkleOffsets = new Float32Array(layer.count);
  const twinkleRates = new Float32Array(layer.count);
  const twinkleAmounts = new Float32Array(layer.count);
  const random = createSeededRandom(0x51a7 + layer.count);
  const direction = new THREE.Vector3();
  const galaxyAxis = new THREE.Vector3(0.25, 0.86, 0.44).normalize();
  const tangentA = new THREE.Vector3(1, 0, 0).cross(galaxyAxis).normalize();
  const tangentB = galaxyAxis.clone().cross(tangentA).normalize();
  const clusterSeeds = Array.from({ length: 24 }, () => sampleUniformDirection(random, new THREE.Vector3()).clone());
  const white = new THREE.Color(0xffffff);
  const paleYellow = new THREE.Color(0xfff3c4);
  const blueWhite = new THREE.Color(0xddeaff);

  for (let index = 0; index < layer.count; index += 1) {
    const distribution = random();
    if (distribution < 0.18) {
      // Compact stellar nurseries add recognizable, seeded clusters.
      const cluster = clusterSeeds[Math.floor(random() * clusterSeeds.length)];
      direction.copy(cluster).add(new THREE.Vector3(
        (random() - 0.5) * 0.12,
        (random() - 0.5) * 0.12,
        (random() - 0.5) * 0.12
      )).normalize();
    } else if (distribution < 0.76) {
      sampleGalaxyDirection(random, direction, galaxyAxis, tangentA, tangentB);
    } else {
      sampleUniformDirection(random, direction);
    }
    const radius = THREE.MathUtils.lerp(layer.radiusMin, layer.radiusMax, random());
    const starPosition = direction.multiplyScalar(radius);
    const colorRoll = random();
    const color = colorRoll < 0.08 ? blueWhite : colorRoll < 0.42 ? paleYellow : white;
    const positionIndex = index * 3;

    positions[positionIndex] = starPosition.x;
    positions[positionIndex + 1] = starPosition.y;
    positions[positionIndex + 2] = starPosition.z;
    colors[positionIndex] = color.r;
    colors[positionIndex + 1] = color.g;
    colors[positionIndex + 2] = color.b;
    sizes[index] = THREE.MathUtils.lerp(layer.sizeMin, layer.sizeMax, random());
    opacities[index] = layer.opacity * THREE.MathUtils.lerp(0.68, 1.0, random());
    twinkleOffsets[index] = random() * Math.PI * 2;
    twinkleRates[index] = THREE.MathUtils.lerp(1.8, 3.8, random());
    twinkleAmounts[index] = layer.twinkle;
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("starColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("starSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("starOpacity", new THREE.BufferAttribute(opacities, 1));
  geometry.setAttribute("twinkleOffset", new THREE.BufferAttribute(twinkleOffsets, 1));
  geometry.setAttribute("twinkleRate", new THREE.BufferAttribute(twinkleRates, 1));
  geometry.setAttribute("twinkleAmount", new THREE.BufferAttribute(twinkleAmounts, 1));

  const points = new THREE.Points(geometry, createStarfieldMaterial());
  scene.add(points);
  starLayers.push(points);
}

starfieldLayers.forEach(createDistantStarField);
// The Sun is the only direct light source. A point light at the Sun keeps each
// body's terminator and cast shadow aligned with its current orbital position.
const sunlight = new THREE.PointLight(0xffffff, 5.6, 0, 2);
sunlight.position.copy(sun.position);
sunlight.castShadow = true;
sunlight.shadow.mapSize.setScalar(isMobileViewport ? 1024 : 2048);
sunlight.shadow.camera.near = 1;
sunlight.shadow.camera.far = 360;
sunlight.shadow.bias = -0.0002;
scene.add(sunlight);

//MERCURY
var mercuryGeometry = new THREE.SphereGeometry(BODY_RADII.mercury, 64, 32);
var mercuryTexture = loadColorTexture("planetImages/mercury.jpg");
var mercuryMaterial = new THREE.MeshStandardMaterial({
  map: mercuryTexture,
  normalMap: surfaceNormal,
  normalScale: new THREE.Vector2(0.2, 0.2),
  roughness: 1,
  metalness: 0
  
});
var mercury = new THREE.Mesh(mercuryGeometry, mercuryMaterial);
mercury.position.set(0, 0, 0);
scene.add(mercury);

//VENUS
var venusGeometry = new THREE.SphereGeometry(BODY_RADII.venus, 64, 32);
var venusTexture = loadNormalTexture("planetTextures/venustexture.jpg");
var venusMaterial = new THREE.MeshStandardMaterial({
  // The bundled Venus photo is a perspective image, not a lat-long map. A
  // material tint plus the supplied 2:1 normal map avoids stretching it over
  // every longitude on the globe.
  color: 0xc17a38,
  normalMap: venusTexture,
  normalScale: new THREE.Vector2(0.3, 0.3),
  roughness: 1,
  metalness: 0
});
var venus = new THREE.Mesh(venusGeometry, venusMaterial);
venus.position.set(0, 0, 0);
scene.add(venus);

//EARTH
var planet = new THREE.SphereGeometry(BODY_RADII.earth, 64, 32);
var earthSkin = new THREE.TextureLoader().load("planetImages/earth2.jpg");
earthSkin.minFilter = THREE.LinearFilter;
var earthTexture = new THREE.TextureLoader().load('planetTextures/earthtexture.jpg');
earthTexture.minFilter = THREE.LinearFilter;
var planetMaterial = new THREE.MeshStandardMaterial({
  map: earthSkin,
  normalMap: earthTexture,
  bumpMap: earthTexture,
  roughness: 1,
  metalness: 0
});
var earth = new THREE.Mesh(planet, planetMaterial);
earth.position.set(0, 0, 0);
scene.add(earth);

//MOON
const moonShape = new THREE.SphereGeometry(BODY_RADII.moon, 64, 32);
const moonSkin = loadColorTexture("planetImages/moon.jpg");
const moonTexture = loadNormalTexture('planetTextures/moontexture.jpg');
const moonMaterial = new THREE.MeshStandardMaterial({ 
  map: moonSkin,
  normalMap: moonTexture,
  normalScale: new THREE.Vector2(0.4, 0.4),
  roughness: 1,
  metalness: 0
});
const moon = new THREE.Mesh(moonShape, moonMaterial);
scene.add(moon);
moon.position.set(0, 0, 0);

//MARS
var marsGeometry = new THREE.SphereGeometry(BODY_RADII.mars, 64, 32);
var marsSkin = loadColorTexture("planetImages/mars.jpg");
var marsTexture = loadNormalTexture("planetTextures/marstexture.jpg", new THREE.Vector2(2, 1));

var marsMaterial = new THREE.MeshStandardMaterial({
  map: marsSkin,
  normalMap: marsTexture,
  normalScale: new THREE.Vector2(0.18, 0.18),
  roughness: 1,
  metalness: 0,
});
var mars = new THREE.Mesh(marsGeometry, marsMaterial);
mars.position.set(0, 0, 0);
scene.add(mars);

//JUPITER
var jupiterGeometry  = new THREE.SphereGeometry(BODY_RADII.jupiter, 64, 32);
var jupiterTexture = loadColorTexture("planetImages/jupiter.jpg");
var jupiterMaterial = new THREE.MeshStandardMaterial({
  map: jupiterTexture,
  roughness: 1,
  metalness: 0,
});
var jupiter = new THREE.Mesh(jupiterGeometry, jupiterMaterial);
jupiter.position.set(0, 0, 0);
scene.add(jupiter);

//SATURN
var saturnGeometry  = new THREE.SphereGeometry(BODY_RADII.saturn, 64, 32);
var saturnTexture = loadColorTexture("planetImages/saturn.jpg");
var saturnMaterial = new THREE.MeshStandardMaterial({
  map: saturnTexture,
  roughness: 1,
  metalness: 0,
});
var saturn = new THREE.Mesh(saturnGeometry, saturnMaterial);
saturn.position.set(0, 0, 0);
scene.add(saturn);

// SATURN RING
const SATURN_AXIAL_TILT = 26.7;
// RingGeometry is flat like the source texture. Its default UVs project a
// square across the ring, so remap them: image width follows the circumference
// and its narrow height follows the radius.
function createRingGeometry(innerRadius, outerRadius, segments = 256) {
  const geometry = new THREE.RingGeometry(innerRadius, outerRadius, segments, 1);
  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const radius = Math.hypot(x, y);
    const angle = Math.atan2(y, x);
    const u = (angle + Math.PI) / (Math.PI * 2);
    const v = (radius - innerRadius) / (outerRadius - innerRadius);
    uvs.setXY(index, u, v);
  }

  uvs.needsUpdate = true;
  return geometry;
}

var saturnRingGeometry = createRingGeometry(BODY_RADII.saturn * 1.15, BODY_RADII.saturn * 2.35);
var saturnRingMaterial = new THREE.ShaderMaterial({
  uniforms: {
    time: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;

    void main() {
      vUv = uv;
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;

    uniform float time;

    float hash(vec3 p) {
      p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    float noise(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
            mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
        mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
            mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
    }

    float fbm(vec3 p) {
      float value = 0.0;
      value += noise(p) * 0.58;
      p = p * 2.03 + 17.0;
      value += noise(p) * 0.28;
      p = p * 2.01 - 9.0;
      value += noise(p) * 0.14;
      return value;
    }

    void main() {
      float radial = clamp(vUv.y, 0.0, 1.0);
      float angle = atan(vWorldPosition.z, vWorldPosition.x);
      float dust = fbm(vec3(radial * 32.0, angle * 3.0 + time * 0.015, 4.0));

      // Fine radial ice/dust bands, with broad warm-gray variation between them.
      float fineBands = 0.5 + 0.5 * sin(radial * 210.0 + dust * 5.0);
      float broadBands = 0.5 + 0.5 * sin(radial * 42.0 + dust * 2.0);
      float bandValue = mix(fineBands, broadBands, 0.22);
      vec3 darkIce = vec3(0.12, 0.115, 0.105);
      vec3 dustyIce = vec3(0.34, 0.31, 0.26);
      vec3 paleIce = vec3(0.58, 0.53, 0.44);
      vec3 brightIce = vec3(0.74, 0.69, 0.59);
      vec3 color = mix(dustyIce, paleIce, smoothstep(0.25, 0.8, bandValue));
      color = mix(color, brightIce, smoothstep(0.8, 1.0, bandValue) * 0.48);
      color = mix(darkIce, color, 0.62 + dust * 0.28);

      // The broad dark gaps mimic Saturn's most recognizable ring divisions.
      float cassiniGap = 1.0 - smoothstep(0.565, 0.605, radial);
      cassiniGap *= smoothstep(0.515, 0.565, radial);
      float innerGap = 1.0 - smoothstep(0.295, 0.325, radial);
      innerGap *= smoothstep(0.255, 0.295, radial);
      float gapMask = max(cassiniGap, innerGap * 0.58);
      color = mix(color, darkIce * 0.38, gapMask);

      float edgeFade = smoothstep(0.0, 0.035, radial) * (1.0 - smoothstep(0.965, 1.0, radial));
      float alpha = edgeFade * (0.46 + bandValue * 0.27) * (1.0 - gapMask * 0.78);
      float warmLight = 0.86 + 0.14 * max(dot(normalize(vWorldNormal), normalize(vec3(0.8, 0.45, 0.35))), 0.0);
      gl_FragColor = vec4(color * warmLight, alpha);
    }
  `,
  transparent: true,
  alphaTest: 0.01,
  side: THREE.DoubleSide,
  depthWrite: false,
});
var saturnRing = new THREE.Mesh(saturnRingGeometry, saturnRingMaterial);
saturnRing.position.set(0, 0, 0);
saturnRing.rotation.set(Math.PI / 2, 0, THREE.MathUtils.degToRad(SATURN_AXIAL_TILT));
scene.add(saturnRing);

//URANUS
var uranusGeometry  = new THREE.SphereGeometry(BODY_RADII.uranus, 64, 32);
var uranusTexture = loadColorTexture("planetImages/uranus.jpg");
var uranusMaterial = new THREE.MeshStandardMaterial({
  map: uranusTexture,
  normalMap: moonTexture,
  normalScale: new THREE.Vector2(0.12, 0.12),
  roughness: 1,
  metalness: 0,
});
var uranus = new THREE.Mesh(uranusGeometry, uranusMaterial);
uranus.position.set(0, 0, 0);
scene.add(uranus);

//NEPTUNE
var neptuneGeometry  = new THREE.SphereGeometry(BODY_RADII.neptune, 64, 32);
var neptuneTexture = loadColorTexture("planetImages/neptune.jpg");
var neptuneMaterial = new THREE.MeshStandardMaterial({
  map: neptuneTexture,
  normalMap: sunNormal,
  normalScale: new THREE.Vector2(0.12, 0.12),
  roughness: 1,
  metalness: 0
});
var neptune = new THREE.Mesh(neptuneGeometry, neptuneMaterial);
neptune.position.set(0, 0, 0);
scene.add(neptune);

const SUN_MEAN_RADIUS_KM = 695700;
const SATELLITE_ORBIT_DISTANCE_SCALE = 0.14;
const MIN_VISIBLE_MOON_RADIUS = 0.035;

function scaledSatelliteRadius(meanRadiusKm) {
  return Math.max(BODY_RADII.sun * meanRadiusKm / SUN_MEAN_RADIUS_KM, MIN_VISIBLE_MOON_RADIUS);
}

function createSatellite(name, meanRadiusKm, color) {
  const geometry = new THREE.SphereGeometry(scaledSatelliteRadius(meanRadiusKm), 32, 16);
  const material = new THREE.MeshStandardMaterial({
    color: color,
    normalMap: moonTexture,
    normalScale: new THREE.Vector2(0.18, 0.18),
    roughness: 1,
    metalness: 0,
  });
  const satellite = new THREE.Mesh(geometry, material);
  satellite.name = name;
  scene.add(satellite);
  return satellite;
}

moon.name = "Moon";

const satelliteSystems = [
  { name: "Moon", parent: earth, parentRadius: BODY_RADII.earth, body: moon, radius: BODY_RADII.moon, orbitPlanetRadii: 60.34, periodDays: 27.321661, inclination: 5.145, phase: 0.5 },
  { name: "Phobos", parent: mars, parentRadius: BODY_RADII.mars, body: createSatellite("Phobos", 11.1, 0x8d8275), orbitPlanetRadii: 2.77, periodDays: 0.3189, inclination: 1.1, phase: 0.2 },
  { name: "Deimos", parent: mars, parentRadius: BODY_RADII.mars, body: createSatellite("Deimos", 6.2, 0x9a9084), orbitPlanetRadii: 6.92, periodDays: 1.2624, inclination: 1.8, phase: 2.3 },
  { name: "Io", parent: jupiter, parentRadius: BODY_RADII.jupiter, body: createSatellite("Io", 1821.6, 0xd8b45b), orbitPlanetRadii: 6.03, periodDays: 1.769, inclination: 0.05, phase: 0.4 },
  { name: "Europa", parent: jupiter, parentRadius: BODY_RADII.jupiter, body: createSatellite("Europa", 1560.8, 0xc8beb0), orbitPlanetRadii: 9.6, periodDays: 3.551, inclination: 0.47, phase: 1.6 },
  { name: "Ganymede", parent: jupiter, parentRadius: BODY_RADII.jupiter, body: createSatellite("Ganymede", 2634.1, 0x9f9182), orbitPlanetRadii: 15.31, periodDays: 7.155, inclination: 0.2, phase: 2.7 },
  { name: "Callisto", parent: jupiter, parentRadius: BODY_RADII.jupiter, body: createSatellite("Callisto", 2410.3, 0x786f68), orbitPlanetRadii: 26.93, periodDays: 16.689, inclination: 0.28, phase: 3.8 },
  { name: "Mimas", parent: saturn, parentRadius: BODY_RADII.saturn, body: createSatellite("Mimas", 198.2, 0xb9b3a8), orbitPlanetRadii: 3.19, periodDays: 0.942, inclination: 1.53, phase: 0.7 },
  { name: "Enceladus", parent: saturn, parentRadius: BODY_RADII.saturn, body: createSatellite("Enceladus", 252.1, 0xe1dfd6), orbitPlanetRadii: 4.09, periodDays: 1.37, inclination: 0.0, phase: 1.9 },
  { name: "Tethys", parent: saturn, parentRadius: BODY_RADII.saturn, body: createSatellite("Tethys", 533.0, 0xc9c2b5), orbitPlanetRadii: 5.06, periodDays: 1.888, inclination: 1.09, phase: 3.1 },
  { name: "Dione", parent: saturn, parentRadius: BODY_RADII.saturn, body: createSatellite("Dione", 561.4, 0xbcb6ad), orbitPlanetRadii: 6.48, periodDays: 2.737, inclination: 0.02, phase: 4.2 },
  { name: "Rhea", parent: saturn, parentRadius: BODY_RADII.saturn, body: createSatellite("Rhea", 763.8, 0xa9a197), orbitPlanetRadii: 9.05, periodDays: 4.518, inclination: 0.35, phase: 5.0 },
  { name: "Titan", parent: saturn, parentRadius: BODY_RADII.saturn, body: createSatellite("Titan", 2574.7, 0xc1904d), orbitPlanetRadii: 20.98, periodDays: 15.945, inclination: 0.33, phase: 2.0 },
  { name: "Iapetus", parent: saturn, parentRadius: BODY_RADII.saturn, body: createSatellite("Iapetus", 734.5, 0x8b8176), orbitPlanetRadii: 61.15, periodDays: 79.322, inclination: 15.47, phase: 4.6 },
  { name: "Miranda", parent: uranus, parentRadius: BODY_RADII.uranus, body: createSatellite("Miranda", 235.8, 0xb8b2a9), orbitPlanetRadii: 5.1, periodDays: 1.413, inclination: 4.34, phase: 0.9 },
  { name: "Ariel", parent: uranus, parentRadius: BODY_RADII.uranus, body: createSatellite("Ariel", 578.9, 0xc5c0b8), orbitPlanetRadii: 7.53, periodDays: 2.52, inclination: 0.04, phase: 2.1 },
  { name: "Umbriel", parent: uranus, parentRadius: BODY_RADII.uranus, body: createSatellite("Umbriel", 584.7, 0x8d8882), orbitPlanetRadii: 10.5, periodDays: 4.144, inclination: 0.13, phase: 3.0 },
  { name: "Titania", parent: uranus, parentRadius: BODY_RADII.uranus, body: createSatellite("Titania", 788.4, 0xb5aaa0), orbitPlanetRadii: 17.19, periodDays: 8.706, inclination: 0.08, phase: 4.0 },
  { name: "Oberon", parent: uranus, parentRadius: BODY_RADII.uranus, body: createSatellite("Oberon", 761.4, 0x9d948b), orbitPlanetRadii: 23.01, periodDays: 13.463, inclination: 0.07, phase: 5.2 },
  { name: "Triton", parent: neptune, parentRadius: BODY_RADII.neptune, body: createSatellite("Triton", 1352.6, 0xbdb7aa), orbitPlanetRadii: 14.41, periodDays: -5.877, inclination: 23.0, phase: 1.3 },
];

satelliteSystems.forEach((satellite) => {
  satellite.radius = satellite.radius ?? scaledSatelliteRadius(satellite.body.geometry.parameters.radius * SUN_MEAN_RADIUS_KM / BODY_RADII.sun);
  satellite.orbitRadius = Math.max(
    satellite.parentRadius * satellite.orbitPlanetRadii * SATELLITE_ORBIT_DISTANCE_SCALE,
    satellite.parentRadius + satellite.radius + 0.08
  );
});

const satelliteBodies = satelliteSystems.map((satellite) => satellite.body);
const orbitingBodies = [mercury, venus, earth, mars, jupiter, saturn, uranus, neptune, ...satelliteBodies];
orbitingBodies.forEach((body) => {
  body.castShadow = true;
  body.receiveShadow = true;
});
satelliteBodies.forEach((body) => {
  body.castShadow = false;
});
saturnRing.receiveShadow = true;

/*
//SPACESHIP
const spaceshipGeometry = new THREE.TetrahedronGeometry(5.659, 1);
const spaceshipSkin = new THREE.TextureLoader().load("steel.jpg");
const spaceshipNormalTexture = new THREE.TextureLoader().load('steelnormaltexture.png');
const spaceshipDisplacement = new THREE.TextureLoader().load('steeldisplacement.png');
const spaceshipMaterial = new THREE.MeshStandardMaterial({ 
  map: spaceshipSkin,
  normalMap: spaceshipNormalTexture,
  displacementMap: spaceshipDisplacement,
  metalness: 0.3, 
  roughness: 0.2,
  antialias: true
});
const spaceship = new THREE.Mesh(spaceshipGeometry, spaceshipMaterial);
spaceship.position.set(0, 0, 0);
var spaceshipSpeed = 0.1;
scene.add(spaceship);

*/

var position = 0;
const clock = new THREE.Clock();

// Orbital distances are logarithmically compressed for a readable scene, but
// eccentricities, inclinations, and periods are based on real solar-system data.
// The simulation runs at one-tenth of the previous baseline speed. The GUI's
// time multiplier can bring it back up to the old pace at 10x.
const earthYearSeconds = 60;
const baseSimulationRate = 0.1;
const orbitalBodies = [
  { body: mercury, radius: 80, period: 0.240846, eccentricity: 0.2056, inclination: 7.005, node: 48.331, phase: 0.2 },
  { body: venus, radius: 104, period: 0.615198, eccentricity: 0.0068, inclination: 3.395, node: 76.680, phase: 1.1 },
  { body: earth, radius: 122, period: 1, eccentricity: 0.0167, inclination: 0, node: 0, phase: 2.2 },
  { body: mars, radius: 145, period: 1.8808, eccentricity: 0.0934, inclination: 1.850, node: 49.558, phase: 3.25 },
  { body: jupiter, radius: 190, period: 11.862, eccentricity: 0.0489, inclination: 1.304, node: 100.464, phase: 4.15 },
  { body: saturn, radius: 220, period: 29.457, eccentricity: 0.0565, inclination: 2.485, node: 113.665, phase: 5.1 },
  { body: uranus, radius: 255, period: 84.017, eccentricity: 0.0472, inclination: 0.772, node: 74.006, phase: 0.85 },
  { body: neptune, radius: 300, period: 164.79, eccentricity: 0.0086, inclination: 1.767, node: 131.784, phase: 2.75 },
];

// Reuse the orbital elements to draw the same ellipses the planets follow.
const orbitLines = orbitalBodies.map((orbit) => {
  const points = [];
  const inclination = THREE.MathUtils.degToRad(orbit.inclination);
  const node = THREE.MathUtils.degToRad(orbit.node);
  for (let index = 0; index <= 256; index += 1) {
    const anomaly = index * Math.PI * 2 / 256;
    const x = orbit.radius * (Math.cos(anomaly) - orbit.eccentricity);
    const z = orbit.radius * Math.sqrt(1 - orbit.eccentricity ** 2) * Math.sin(anomaly);
    const tiltedZ = z * Math.cos(inclination);
    points.push(new THREE.Vector3(
      x * Math.cos(node) - tiltedZ * Math.sin(node),
      z * Math.sin(inclination),
      x * Math.sin(node) + tiltedZ * Math.cos(node)
    ));
  }
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x82abc6, transparent: true, opacity: 0.18, depthWrite: false })
  );
  line.visible = false;
  scene.add(line);
  return line;
});

// Concise, paraphrased facts with a NASA source attached to each selection.
const nasaFacts = {
  Sun: ["Star", "A 4.5-billion-year-old star whose gravity holds the solar system together.", "https://science.nasa.gov/sun/facts/"],
  Mercury: ["Planet", "The solar system's fastest planet completes an orbit in just 88 Earth days.", "https://science.nasa.gov/mercury/facts/"],
  Venus: ["Planet", "Its dense atmosphere makes Venus the hottest planet, even hotter than Mercury.", "https://science.nasa.gov/venus/facts/"],
  Earth: ["Planet", "Earth is the only world known to have liquid oceans on its surface.", "https://science.nasa.gov/earth/facts/"],
  Mars: ["Planet", "Olympus Mons on Mars is the largest volcano in the solar system.", "https://science.nasa.gov/mars/facts/"],
  Jupiter: ["Planet", "Jupiter is the largest planet in our solar system.", "https://science.nasa.gov/jupiter/facts/"],
  Saturn: ["Planet", "Saturn's rings are made of countless pieces of ice and rock.", "https://science.nasa.gov/saturn/facts/"],
  Uranus: ["Planet", "Uranus rotates on its side, with an axial tilt of about 98 degrees.", "https://science.nasa.gov/uranus/facts/"],
  Neptune: ["Planet", "Neptune was the first planet located through mathematical prediction.", "https://science.nasa.gov/neptune/facts/"],
  Moon: ["Earth's moon", "The Moon is Earth's only natural satellite, and its gravity drives ocean tides.", "https://science.nasa.gov/moon/facts/"],
  Phobos: ["Mars moon", "Phobos is the larger of Mars's two small moons.", "https://science.nasa.gov/mars/moons/"],
  Deimos: ["Mars moon", "Deimos is the smaller and more distant of Mars's two moons.", "https://science.nasa.gov/mars/moons/"],
  Io: ["Jupiter moon", "Io is the most volcanically active world in the solar system.", "https://science.nasa.gov/jupiter/jupiter-moons/io/facts/"],
  Europa: ["Jupiter moon", "An ocean beneath Europa's icy shell may hold more water than Earth's oceans.", "https://science.nasa.gov/jupiter/jupiter-moons/europa/europa-facts/"],
  Ganymede: ["Jupiter moon", "Ganymede is the largest moon in the solar system and has its own magnetic field.", "https://science.nasa.gov/jupiter/jupiter-moons/ganymede/facts/"],
  Callisto: ["Jupiter moon", "Callisto is Jupiter's second-largest moon and has a heavily cratered surface.", "https://science.nasa.gov/jupiter/jupiter-moons/callisto/facts/"],
  Mimas: ["Saturn moon", "A giant impact crater gives Mimas its distinctive appearance.", "https://science.nasa.gov/saturn/moons/facts/"],
  Enceladus: ["Saturn moon", "Enceladus has a global ocean beneath its icy crust and sprays water into space.", "https://science.nasa.gov/saturn/moons/facts/"],
  Tethys: ["Saturn moon", "Cassini observed mysterious red arcs on Tethys's icy surface.", "https://science.nasa.gov/saturn/moons/facts/"],
  Dione: ["Saturn moon", "Cassini detected a very thin atmosphere around Dione.", "https://science.nasa.gov/saturn/moons/facts/"],
  Rhea: ["Saturn moon", "Rhea has an extremely thin atmosphere detected by Cassini.", "https://science.nasa.gov/saturn/moons/facts/"],
  Titan: ["Saturn moon", "Titan has a thick atmosphere and lakes of liquid methane and ethane.", "https://science.nasa.gov/saturn/moons/titan/facts/"],
  Iapetus: ["Saturn moon", "One hemisphere of Iapetus is bright while the other is remarkably dark.", "https://science.nasa.gov/saturn/moons/facts/"],
  Miranda: ["Uranus moon", "Miranda has enormous fault canyons, some much deeper than the Grand Canyon.", "https://science.nasa.gov/uranus/moons/facts/"],
  Ariel: ["Uranus moon", "Ariel has the brightest, possibly youngest surface of Uranus's major moons.", "https://science.nasa.gov/uranus/moons/facts/"],
  Umbriel: ["Uranus moon", "Umbriel is the darkest of Uranus's five major moons.", "https://science.nasa.gov/uranus/moons/facts/"],
  Titania: ["Uranus moon", "Titania is the largest of Uranus's moons.", "https://science.nasa.gov/uranus/moons/facts/"],
  Oberon: ["Uranus moon", "Oberon is heavily cratered and is Uranus's second-largest moon.", "https://science.nasa.gov/uranus/moons/oberon/"],
  Triton: ["Neptune moon", "Triton is a large moon with a retrograde orbit and active geysers.", "https://science.nasa.gov/neptune/moons/triton/"],
};

const selectableBodies = new Map([
  ["Sun", sun],
  ...orbitalBodies.map(({ body }, index) => [["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"][index], body]),
  ...satelliteSystems.map(({ name, body }) => [name, body]),
]);
const infoPanel = document.getElementById("body-info");
const uiState = { orbitLines: false, timeScale: 1, selectBody: "Choose a body" };
const controlsPanel = document.getElementById("controls-panel");
const gui = new GUI({ container: controlsPanel, title: "" });
gui.close();
gui.add(uiState, "orbitLines").name("Orbit lines").onChange((visible) => {
  orbitLines.forEach((line) => { line.visible = visible; });
});
gui.add(uiState, "timeScale", 0, 10, 0.1).name("Time speed");
const bodyPicker = gui.add(uiState, "selectBody", ["Choose a body", ...selectableBodies.keys()]).name("Body");

function showBodyInfo(name) {
  const fact = nasaFacts[name];
  if (!fact) return;
  focusBody(selectableBodies.get(name));
  document.getElementById("body-type").textContent = fact[0];
  document.getElementById("body-name").textContent = name;
  document.getElementById("body-fact").textContent = fact[1];
  document.getElementById("body-source").href = fact[2];
  infoPanel.hidden = false;
  uiState.selectBody = name;
  bodyPicker.updateDisplay();
}

bodyPicker.onChange((name) => {
  if (name !== "Choose a body") showBodyInfo(name);
});
document.getElementById("close-info").addEventListener("click", () => {
  infoPanel.hidden = true;
  stopFollowing();
  uiState.selectBody = "Choose a body";
  bodyPicker.updateDisplay();
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDown = null;
renderer.domElement.addEventListener("pointerdown", (event) => {
  pointerDown = { x: event.clientX, y: event.clientY };
});
renderer.domElement.addEventListener("pointerup", (event) => {
  if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6) return;
  pointerDown = null;
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([...selectableBodies.values()], false);
  if (hits.length) {
    const selected = [...selectableBodies].find(([, body]) => body === hits[0].object);
    if (selected) showBodyInfo(selected[0]);
  }
});

// Sidereal rotation periods in Earth days. With one year set to 60 seconds,
// this preserves the real day-to-year relationship (including retrograde spin).
const rotatingBodies = [
  // Deliberately slowed for the cinematic view: the surface still moves
  // visibly, but the Sun remains a calm, slowly turning focal point.
  { body: sun, periodDays: -8000, tilt: 7.25, phase: 0 },
  { body: mercury, periodDays: 58.646, tilt: 0.034, phase: 0.6 },
  { body: venus, periodDays: -243.025, tilt: 177.36, phase: 1.8 },
  { body: earth, periodDays: 0.99727, tilt: 23.44, phase: 0.2 },
  { body: mars, periodDays: 1.02596, tilt: 25.19, phase: 2.5 },
  { body: jupiter, periodDays: 0.41354, tilt: 3.13, phase: 0.9 },
  { body: saturn, periodDays: 0.44401, tilt: SATURN_AXIAL_TILT, phase: 2.1 },
  { body: uranus, periodDays: -0.71833, tilt: 97.77, phase: 1.5 },
  { body: neptune, periodDays: 0.67125, tilt: 28.32, phase: 0.4 },
  ...satelliteSystems.map((satellite) => ({
    body: satellite.body,
    periodDays: satellite.periodDays,
    tilt: satellite.inclination,
    phase: satellite.phase,
  })),
];

function updateAxialRotations(elapsed) {
  rotatingBodies.forEach((rotation) => {
    const periodSeconds = earthYearSeconds * rotation.periodDays / 365.256;
    rotation.body.rotation.set(
      0,
      rotation.phase + elapsed * Math.PI * 2 / periodSeconds,
      THREE.MathUtils.degToRad(rotation.tilt)
    );
  });
}

function solveEccentricAnomaly(meanAnomaly, eccentricity) {
  let eccentricAnomaly = meanAnomaly;
  for (let iteration = 0; iteration < 5; iteration += 1) {
    eccentricAnomaly -= (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly)
      / (1 - eccentricity * Math.cos(eccentricAnomaly));
  }
  return eccentricAnomaly;
}

function updateOrbitalBodies(elapsed) {
  orbitalBodies.forEach((orbit) => {
    const meanAnomaly = orbit.phase + elapsed * Math.PI * 2 / (earthYearSeconds * orbit.period);
    const eccentricAnomaly = solveEccentricAnomaly(meanAnomaly, orbit.eccentricity);
    const x = orbit.radius * (Math.cos(eccentricAnomaly) - orbit.eccentricity);
    const z = orbit.radius * Math.sqrt(1 - orbit.eccentricity ** 2) * Math.sin(eccentricAnomaly);
    const inclination = THREE.MathUtils.degToRad(orbit.inclination);
    const node = THREE.MathUtils.degToRad(orbit.node);
    const tiltedZ = z * Math.cos(inclination);

    orbit.body.position.set(
      x * Math.cos(node) - tiltedZ * Math.sin(node),
      z * Math.sin(inclination),
      x * Math.sin(node) + tiltedZ * Math.cos(node)
    );
  });

  saturnRing.position.copy(saturn.position);
}

function updateSatelliteSystems(elapsed) {
  satelliteSystems.forEach((satellite) => {
    const periodSeconds = earthYearSeconds * satellite.periodDays / 365.256;
    const angle = satellite.phase + elapsed * Math.PI * 2 / periodSeconds;
    const inclination = THREE.MathUtils.degToRad(satellite.inclination);
    const node = THREE.MathUtils.degToRad(satellite.node ?? 0);
    const x = Math.cos(angle) * satellite.orbitRadius;
    const z = Math.sin(angle) * satellite.orbitRadius;
    const tiltedZ = z * Math.cos(inclination);

    satellite.body.position.set(
      satellite.parent.position.x + x * Math.cos(node) - tiltedZ * Math.sin(node),
      satellite.parent.position.y + z * Math.sin(inclination),
      satellite.parent.position.z + x * Math.sin(node) + tiltedZ * Math.cos(node)
    );
  });
}

function updateStarField(starLayer, elapsed) {
  starLayer.forEach((layer) => {
    layer.material.uniforms.time.value = elapsed;
  });
}

let simulationElapsed = 0;
function animate() {
  const delta = Math.min(clock.getDelta(), 0.05);
  simulationElapsed += delta * baseSimulationRate * uiState.timeScale;
  sunMaterial.uniforms.time.value = simulationElapsed;
  saturnRingMaterial.uniforms.time.value = simulationElapsed;
  updateOrbitalBodies(simulationElapsed);
  updateSatelliteSystems(simulationElapsed);
  updateAxialRotations(simulationElapsed);

  /*
  //SPACESHIP
  position.x += speed;
  position.y += speed;
  position.z += speed;
*/
updateStarField(starLayers, clock.getElapsedTime());




  // check if the object has reached the edge of the screen
  if (
    position.x > window.innerWidth / 2 ||
    position.x < -window.innerWidth / 2
  ) {
    speed = -speed; // reverse direction
  }
  if (
    position.y > window.innerHeight / 2 ||
    position.y < -window.innerHeight / 2
  ) {
    speed = -speed; // reverse direction
  }
  /*
  spaceship.rotation.x += 0.03;
  spaceship.rotation.y += 0.01;
  spaceship.rotation.z += 0.02;
  */
  updateCameraFocus(delta);
  controls.update();

  
  updateBloomScreenMask();
  composer.render(delta);
  requestAnimationFrame(animate);

  
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);
  starLayers.forEach((layer) => {
    layer.material.uniforms.pixelRatio.value = renderer.getPixelRatio();
  });
});



animate();
