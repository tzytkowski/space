// The import map in index.html locks these modules to one Three.js release.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(
  58, // Field of View
  window.innerWidth / window.innerHeight,
  0.1,
  85000
);
const isMobileViewport = window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
var renderer = new THREE.WebGLRenderer({ antialias: !isMobileViewport });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobileViewport ? 1.25 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
document.body.appendChild(renderer.domElement);

const cameraTarget = new THREE.Vector3(0, 0, 0);
camera.position.set(-40, 135, -680);
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


//CAMERA HELPER
//const helper = new THREE.CameraHelper( camera );
//scene.add( helper );

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
var sunSkin = loadColorTexture("planetImages/sun.png");
var sunTexture = loadColorTexture("planetImages/sunny.jpg");
var sunMaterial = new THREE.MeshStandardMaterial({ 
  map: sunSkin, 
  normalMap: sunNormal,
  normalScale: new THREE.Vector2(0.35, 0.35),
  emissiveMap: sunTexture, //Use the same texture for emissive to make the sun glow
  emissive: 0xffffff, 
  emissiveIntensity: 4.5, 
  roughness: 1,
  metalness: 0
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
  { count: isMobileViewport ? 2600 : 3800, radiusMin: 36000, radiusMax: 46000, sizeMin: 28, sizeMax: 70, opacity: 0.48, twinkle: 0.52 },
  { count: isMobileViewport ? 5200 : 8000, radiusMin: 52000, radiusMax: 66000, sizeMin: 42, sizeMax: 95, opacity: 0.5, twinkle: 0.44 },
  { count: isMobileViewport ? 5000 : 7000, radiusMin: 72000, radiusMax: 84000, sizeMin: 55, sizeMax: 120, opacity: 0.42, twinkle: 0.32 },
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
        float twinkle = 1.0 - twinkleAmount * 0.5 + twinkleAmount * pulse;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = starSize * twinkle * pixelRatio * (120.0 / max(-mvPosition.z, 1.0));
        gl_Position = projectionMatrix * mvPosition;
        vColor = starColor;
        vAlpha = starOpacity * (0.65 + 0.35 * pulse);
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

function createDistantStarField(layer) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(layer.count * 3);
  const colors = new Float32Array(layer.count * 3);
  const sizes = new Float32Array(layer.count);
  const opacities = new Float32Array(layer.count);
  const twinkleOffsets = new Float32Array(layer.count);
  const twinkleRates = new Float32Array(layer.count);
  const twinkleAmounts = new Float32Array(layer.count);
  const direction = new THREE.Vector3();
  const white = new THREE.Color(0xffffff);
  const paleYellow = new THREE.Color(0xfff3c4);

  for (let index = 0; index < layer.count; index += 1) {
    direction.randomDirection();
    const radius = THREE.MathUtils.randFloat(layer.radiusMin, layer.radiusMax);
    const starPosition = direction.multiplyScalar(radius);
    const color = Math.random() < 0.38 ? paleYellow : white;
    const positionIndex = index * 3;

    positions[positionIndex] = starPosition.x;
    positions[positionIndex + 1] = starPosition.y;
    positions[positionIndex + 2] = starPosition.z;
    colors[positionIndex] = color.r;
    colors[positionIndex + 1] = color.g;
    colors[positionIndex + 2] = color.b;
    sizes[index] = THREE.MathUtils.randFloat(layer.sizeMin, layer.sizeMax);
    opacities[index] = layer.opacity * THREE.MathUtils.randFloat(0.68, 1.0);
    twinkleOffsets[index] = Math.random() * Math.PI * 2;
    twinkleRates[index] = THREE.MathUtils.randFloat(1.1, 2.4);
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
var earthSkin = new THREE.TextureLoader().load("planetImages/earth.jpg");
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
var saturnRingTexture = loadColorTexture("planetImages/saturnring.png");
var saturnRingMaterial = new THREE.MeshStandardMaterial({
  map: saturnRingTexture,
  transparent: true,
  alphaTest: 0.02,
  side: THREE.DoubleSide,
  depthWrite: false,
  roughness: 0.65,
  metalness: 0.0,
});
var saturnRing = new THREE.Mesh(saturnRingGeometry, saturnRingMaterial);
saturnRing.position.set(0, 0, 0);
saturnRing.rotation.x = Math.PI / 2;
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
// One Earth year is exactly 60 real-time seconds.
const earthYearSeconds = 60;
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

// Sidereal rotation periods in Earth days. With one year set to 60 seconds,
// this preserves the real day-to-year relationship (including retrograde spin).
const rotatingBodies = [
  { body: sun, periodDays: 1200.5, tilt: 7.25, phase: 0 },
  { body: mercury, periodDays: 58.646, tilt: 0.034, phase: 0.6 },
  { body: venus, periodDays: -243.025, tilt: 177.36, phase: 1.8 },
  { body: earth, periodDays: 0.99727, tilt: 23.44, phase: 0.2 },
  { body: mars, periodDays: 1.02596, tilt: 25.19, phase: 2.5 },
  { body: jupiter, periodDays: 0.41354, tilt: 3.13, phase: 0.9 },
  { body: saturn, periodDays: 0.44401, tilt: 26.73, phase: 2.1 },
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

function animate() {
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.getElapsedTime();
  updateOrbitalBodies(elapsed);
  updateSatelliteSystems(elapsed);
  updateAxialRotations(elapsed);

  /*
  //SPACESHIP
  position.x += speed;
  position.y += speed;
  position.z += speed;
*/
updateStarField(starLayers, elapsed);




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
  controls.update();

  
  renderer.render(scene, camera);
  requestAnimationFrame(animate);

  
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobileViewport ? 1.25 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  starLayers.forEach((layer) => {
    layer.material.uniforms.pixelRatio.value = renderer.getPixelRatio();
  });
});



animate();
