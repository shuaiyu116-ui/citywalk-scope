import * as THREE from '/vendor/three/three.module.js';
import { OrbitControls } from '/vendor/three/OrbitControls.js';

const COLORS = {
  ground: 0xeaf0ec,
  street: 0xffffff,
  pavement: 0xdce5e2,
  route: 0x187b83,
  active: 0xef7353,
  building: 0xfafcfc,
  roof: 0xe0e9e7,
  tree: 0x82ae91,
  trunk: 0x9ca6a0,
  text: '#243d3f'
};

// A small, restrained palette keeps the scene legible while making each
// generated block feel less like an identical placeholder.
const BUILDING_COLORS = [0xf8eee4, 0xf3f6ef, 0xe7efed, 0xf5e7d8, 0xe6e9f0];
const ROOF_COLORS = [0xd8cfc5, 0xd6e2df, 0xd9dbe5, 0xe5d4c8];

function readCoordinates(stop) {
  const pair = stop?.coordinates ?? stop?.coordinate;
  const rawLatitude = stop?.location?.lat ?? stop?.lat ?? (Array.isArray(pair) ? pair[1] : undefined);
  const rawLongitude = stop?.location?.lng ?? stop?.location?.lon ?? stop?.lng ?? stop?.lon ?? (Array.isArray(pair) ? pair[0] : undefined);
  if (rawLatitude == null || rawLongitude == null || rawLatitude === '' || rawLongitude === '') return null;
  const lat = Number(rawLatitude);
  const lng = Number(rawLongitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < String(value || '').length; index += 1) {
    hash ^= String(value).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readWalkingCoordinates(route) {
  const value = route?.walkingPath?.coordinates
    ?? route?.walkingPath?.geometry?.coordinates
    ?? route?.walkingPath?.route?.geometry?.coordinates;
  if (!Array.isArray(value)) return [];
  // Valhalla is returned as [latitude, longitude] for Leaflet. Other
  // adapters may provide GeoJSON [longitude, latitude].
  const valhallaFormat = route?.walkingPath?.source === 'valhalla';
  const points = value.map(pair => {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const lat = Number(valhallaFormat ? pair[0] : pair[1]);
    const lng = Number(valhallaFormat ? pair[1] : pair[0]);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  }).filter(Boolean);
  if (points.length <= 96) return points;

  // Reduce dense router output while retaining corners. Uniform index
  // sampling can skip a short, sharp turn when a long straight segment has
  // many more vertices than the turn itself.
  const distanceToSegment = (point, start, end) => {
    const latitudeScale = Math.max(0.05, Math.cos(((point.lat + start.lat + end.lat) / 3) * Math.PI / 180));
    const px = point.lng * latitudeScale;
    const pz = point.lat;
    const sx = start.lng * latitudeScale;
    const sz = start.lat;
    const ex = end.lng * latitudeScale;
    const ez = end.lat;
    const dx = ex - sx;
    const dz = ez - sz;
    const lengthSquared = dx * dx + dz * dz;
    const amount = lengthSquared ? Math.max(0, Math.min(1, ((px - sx) * dx + (pz - sz) * dz) / lengthSquared)) : 0;
    return Math.hypot(px - sx - amount * dx, pz - sz - amount * dz);
  };
  const tolerance = 0.000018; // roughly two metres at city latitudes
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const pending = [[0, points.length - 1]];
  while (pending.length) {
    const [startIndex, endIndex] = pending.pop();
    let furthestIndex = -1;
    let furthestDistance = tolerance;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = distanceToSegment(points[index], points[startIndex], points[endIndex]);
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthestIndex = index;
      }
    }
    if (furthestIndex >= 0) {
      keep[furthestIndex] = 1;
      pending.push([startIndex, furthestIndex], [furthestIndex, endIndex]);
    }
  }
  const simplified = points.filter((_, index) => keep[index]);
  if (simplified.length <= 96) return simplified;

  // Very winding routes can still exceed the mesh budget. Downsample only
  // after simplification so the visible path keeps the important bends.
  const sampled = [];
  for (let index = 0; index < 96; index += 1) {
    sampled.push(simplified[Math.round(index * (simplified.length - 1) / 95)]);
  }
  return sampled;
}

function projectStops(stops, route = null) {
  const coordinates = stops.map(readCoordinates);
  const hasCoordinates = coordinates.length > 0 && coordinates.every(Boolean);
  const walkingCoordinates = readWalkingCoordinates(route);
  const hasWalkingPath = walkingCoordinates.length > 1;
  let points;
  let walkingPoints;

  if (hasCoordinates) {
    const origin = coordinates[0];
    const latitudeScale = Math.max(0.05, Math.cos(origin.lat * Math.PI / 180));
    const project = ({ lat, lng }) => {
      const longitudeDelta = ((lng - origin.lng + 540) % 360) - 180;
      return new THREE.Vector3(longitudeDelta * latitudeScale, 0, origin.lat - lat);
    };
    points = coordinates.map(project);
    walkingPoints = hasWalkingPath ? walkingCoordinates.map(project) : [];
  } else {
    points = stops.map((_, index) => new THREE.Vector3(index * 23, 0, Math.sin(index * 1.2) * 23));
    walkingPoints = [];
  }

  if (!points.length) return { points, hasCoordinates, width: 100, depth: 88 };
  const bounds = new THREE.Box3().setFromPoints(points.concat(walkingPoints));
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const scale = Math.max(size.x, size.z) > 0.000001 ? 82 / Math.max(size.x, size.z) : 1;
  points.forEach(point => point.sub(center).multiplyScalar(scale));
  walkingPoints.forEach(point => point.sub(center).multiplyScalar(scale));
  return {
    points,
    walkingPoints: walkingPoints.length > 1 ? walkingPoints : points,
    hasCoordinates,
    hasWalkingPath,
    width: Math.max(102, size.x * scale + 44),
    depth: Math.max(88, size.z * scale + 44)
  };
}

function disposeGroup(group) {
  const textures = new Set();
  const materials = new Set();
  const geometries = new Set();
  group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) {
      const list = Array.isArray(object.material) ? object.material : [object.material];
      list.forEach(material => {
        materials.add(material);
        if (material.map) textures.add(material.map);
      });
    }
  });
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
  group.clear();
}

function createTextSprite(text, options = {}) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  const number = Boolean(options.number);
  const fontSize = number ? 60 : 28;
  context.font = `600 ${fontSize}px Arial, "Microsoft YaHei", sans-serif`;
  canvas.width = number ? 128 : Math.min(720, Math.max(150, Math.ceil(context.measureText(text).width) + 36));
  canvas.height = number ? 128 : 62;
  context.font = `600 ${fontSize}px Arial, "Microsoft YaHei", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = number ? (options.active ? '#ef7353' : '#187b83') : 'rgba(255,255,255,0.94)';
  if (number) {
    context.beginPath();
    context.arc(64, 64, 56, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 6;
    context.stroke();
  } else {
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.fillStyle = number ? '#ffffff' : COLORS.text;
  context.fillText(text, canvas.width / 2, canvas.height / 2 + (number ? 2 : 0), canvas.width - 24);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(number ? 5.4 : canvas.width / 16, number ? 5.4 : canvas.height / 16, 1);
  sprite.userData.aspectRatio = canvas.width / canvas.height;
  sprite.renderOrder = number ? 20 : 19;
  return sprite;
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const amount = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared)) : 0;
  return Math.hypot(point.x - start.x - amount * dx, point.z - start.z - amount * dz);
}

function isNearRoute(point, points, margin) {
  if (points.some(stop => stop.distanceTo(point) < margin + 3)) return true;
  return points.slice(1).some((end, index) => distanceToSegment(point, points[index], end) < margin);
}

function disabledScene() {
  const noop = () => {};
  return { available: false, setRoute: noop, setActiveStop: noop, setVisible: noop, resetCamera: noop, dispose: noop };
}

export function createRouteScene(container, { onSelect, onReady, onError } = {}) {
  if (!container || typeof container.appendChild !== 'function') {
    const error = new Error('A 3D scene container is required.');
    onError?.(error);
    return disabledScene();
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  } catch (error) {
    onError?.(error);
    return disabledScene();
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(COLORS.ground, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.setAttribute('aria-label', 'Citywalk 3D route preview');
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.tabIndex = 0;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.ground);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 900);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = Math.PI * 0.12;
  controls.maxPolarAngle = Math.PI * 0.43;
  controls.enablePan = true;
  controls.maxDistance = 420;
  controls.minDistance = 35;
  controls.zoomSpeed = 0.8;
  controls.rotateSpeed = 0.6;

  scene.add(new THREE.HemisphereLight(0xf4fbff, 0x99aaa2, 2.1));
  const sunlight = new THREE.DirectionalLight(0xffffff, 2.7);
  sunlight.position.set(-45, 95, 48);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(1024, 1024);
  sunlight.shadow.camera.left = -105;
  sunlight.shadow.camera.right = 105;
  sunlight.shadow.camera.top = 105;
  sunlight.shadow.camera.bottom = -105;
  sunlight.shadow.camera.near = 1;
  sunlight.shadow.camera.far = 230;
  sunlight.shadow.normalBias = 0.035;
  sunlight.shadow.bias = -0.0001;
  scene.add(sunlight);

  const routeGroup = new THREE.Group();
  scene.add(routeGroup);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
  let disposed = false;
  let visible = true;
  let contextLost = false;
  let ready = false;
  let frameId = 0;
  let activeIndex = 0;
  let routePoints = [];
  let walkingRoutePoints = [];
  let routeCurve = null;
  let routeLength = 0;
  let traveler = null;
  let routeDimensions = { width: 102, depth: 88 };
  let stopObjects = [];
  let clickTargets = [];
  let pointerDown = null;
  let pixelWidth = 0;
  let pixelHeight = 0;
  let cameraFitDistance = 160;
  let frameTime = 0;
  let walkDistance = 0;
  let coordinateMode = 'schematic';
  let renderedRoute = null;
  const walkerPosition = new THREE.Vector3();
  const spritePosition = new THREE.Vector3();

  function updateStopLabels() {
    const mobile = pixelWidth < 620;
    stopObjects.forEach((stop, index) => {
      stop.group.getWorldPosition(spritePosition);
      const distance = camera.position.distanceTo(spritePosition);
      const unitsPerPixel = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.max(1, pixelHeight);
      const markerSize = unitsPerPixel * (mobile ? 29 : 31);
      [stop.marker, stop.activeMarker].filter(Boolean).forEach(marker => marker.scale.set(markerSize, markerSize, 1));
      if (stop.label) {
        const labelHeight = unitsPerPixel * 22;
        stop.label.scale.set(labelHeight * stop.label.userData.aspectRatio, labelHeight, 1);
        stop.label.position.y = 7.5 + unitsPerPixel * 32;
        stop.label.visible = index === activeIndex || (!mobile && stopObjects.length <= 4);
      }
    });
  }

  function fitCamera() {
    const aspect = camera.aspect || 1;
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const projectedWidth = routeDimensions.width * 0.81 + routeDimensions.depth * 0.3;
    const projectedHeight = (routeDimensions.depth * 0.77 + routeDimensions.width * 0.28) * 0.75 + 14;
    cameraFitDistance = Math.max(projectedWidth / (2 * Math.tan(horizontalFov / 2)), projectedHeight / (2 * Math.tan(verticalFov / 2))) * 1.15;
    const direction = new THREE.Vector3(0.42, 0.84, 1).normalize();
    controls.target.set(0, 1.5, 0);
    camera.position.copy(direction.multiplyScalar(cameraFitDistance)).add(controls.target);
    controls.maxDistance = Math.max(420, cameraFitDistance * 2.1);
    controls.update();
    controls.saveState();
  }

  function resize() {
    if (disposed) return;
    const width = Math.max(1, Math.round(container.clientWidth || 640));
    const height = Math.max(1, Math.round(container.clientHeight || 410));
    if (pixelWidth === width && pixelHeight === height) return;
    const previousAspect = camera.aspect;
    pixelWidth = width;
    pixelHeight = height;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (!ready || Math.abs(previousAspect - camera.aspect) > 0.2) fitCamera();
    requestFrame();
  }

  function requestFrame() {
    if (!disposed && visible && !contextLost && !document.hidden && !frameId) frameId = window.requestAnimationFrame(renderFrame);
  }

  function renderFrame(timestamp) {
    frameId = 0;
    if (disposed || !visible || contextLost || document.hidden) return;
    const elapsed = frameTime ? Math.min((timestamp - frameTime) / 1000, 0.1) : 0;
    frameTime = timestamp;
    if (traveler && routeCurve && routeLength > 0) {
      if (!reducedMotion) walkDistance = (walkDistance + elapsed * 4.8) % routeLength;
      routeCurve.getPointAt(walkDistance / routeLength, walkerPosition);
      traveler.position.copy(walkerPosition);
      traveler.position.y = 1.75;
    }
    if (!reducedMotion && stopObjects[activeIndex]?.ring) {
      const pulse = 1 + Math.sin(timestamp * 0.0027) * 0.11;
      stopObjects[activeIndex].ring.scale.set(pulse, pulse, pulse);
    }
    controls.update();
    updateStopLabels();
    try {
      renderer.render(scene, camera);
    } catch (error) {
      contextLost = true;
      onError?.(error);
      return;
    }
    if (!ready && routePoints.length) {
      ready = true;
      onReady?.({ stopCount: stopObjects.length, coordinateMode, schematicBuildings: true });
    }
    requestFrame();
  }

  function addBox(width, height, depth, material, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    routeGroup.add(mesh);
    return mesh;
  }

  function addFacadeWindows({ width, height, depth, x, z, angle = 0, seed = 0 }) {
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: 0x9fc7c9,
      emissive: 0x315e62,
      emissiveIntensity: 0.16,
      roughness: 0.42,
      metalness: 0.05
    });
    const columns = Math.max(2, Math.min(4, Math.floor(width / 2.3)));
    const rows = Math.max(1, Math.min(5, Math.floor(height / 2)));
    const usableWidth = Math.max(1.6, width - 1.4);
    const usableHeight = Math.max(1.2, height - 1.2);
    const rotateOffset = (localX, localZ) => ({
      x: x + Math.cos(angle) * localX + Math.sin(angle) * localZ,
      z: z - Math.sin(angle) * localX + Math.cos(angle) * localZ
    });
    // A single facade is enough to imply a building without turning the
    // schematic preview into a dense collection of meshes.
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        if ((seed + row * 3 + column) % 11 === 0) continue;
        const localX = columns === 1 ? 0 : -usableWidth / 2 + (column / (columns - 1)) * usableWidth;
        const localZ = -depth / 2 - 0.045;
        const position = rotateOffset(localX, localZ);
        const window = addBox(0.72, Math.min(0.8, usableHeight / rows * 0.48), 0.08, windowMaterial, position.x, 0.95 + (row / Math.max(1, rows - 1)) * usableHeight, position.z);
        window.rotation.y = angle;
        window.castShadow = false;
        window.receiveShadow = false;
      }
    }
  }

  function addLandmarkFeature(stop, point, index, points) {
    const descriptor = `${stop?.name || ''} ${stop?.type || ''}`.toLowerCase();
    const isTower = /(大楼|建筑|地标|博物馆|塔|mansion|building|museum|tower|landmark)/i.test(descriptor);
    const isCafe = /(咖啡|茶|餐|店|brunch|cafe|market|shop)/i.test(descriptor);
    if (!isTower && !isCafe) return;

    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const tangent = next.clone().sub(previous).setY(0);
    if (tangent.lengthSq() < 0.001) tangent.set(1, 0, 0);
    tangent.normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const anchor = point.clone().add(normal.multiplyScalar(isTower ? 8.5 : 6.5));
    const accent = /^#[0-9a-f]{6}$/i.test(stop?.accent || '') ? stop.accent : '#e26d4d';
    const accentMaterial = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.72 });
    const lightMaterial = new THREE.MeshStandardMaterial({ color: 0xf7f2e9, roughness: 0.83 });

    if (isTower) {
      const height = 8.5 + (index % 3) * 1.5;
      const base = addBox(7.2, 0.35, 5.8, accentMaterial, anchor.x, 0.2, anchor.z);
      base.rotation.y = Math.atan2(tangent.x, tangent.z);
      const body = addBox(4.4, height, 4.2, lightMaterial, anchor.x, height / 2 + 0.35, anchor.z);
      body.rotation.y = base.rotation.y;
      addFacadeWindows({ width: 3.6, height: height - 0.9, depth: 4.2, x: anchor.x, z: anchor.z, angle: base.rotation.y, seed: index + 3 });
      const roof = addBox(5.1, 0.35, 4.9, accentMaterial, anchor.x, height + 0.55, anchor.z);
      roof.rotation.y = base.rotation.y;
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.24, 2.1, 8), accentMaterial);
      spire.position.set(anchor.x, height + 1.7, anchor.z);
      spire.castShadow = true;
      routeGroup.add(spire);
    } else {
      const body = addBox(5.4, 2.5, 3.8, lightMaterial, anchor.x, 1.45, anchor.z);
      body.rotation.y = Math.atan2(tangent.x, tangent.z);
      const awning = addBox(6.1, 0.22, 1.65, accentMaterial, anchor.x, 2.75, anchor.z - 1.2);
      awning.rotation.y = body.rotation.y;
      addFacadeWindows({ width: 4.6, height: 1.25, depth: 3.8, x: anchor.x, z: anchor.z, angle: body.rotation.y, seed: index + 6 });
    }
  }

  function addContext(points, width, depth, stops, sceneSeed = 0, pathPoints = points) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width * 2.4, depth * 2.4), new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    routeGroup.add(floor);

    const buildingMaterials = BUILDING_COLORS.map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.88 }));
    const roofMaterials = ROOF_COLORS.map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.94 }));
    const pavementMaterial = new THREE.MeshStandardMaterial({ color: COLORS.pavement, roughness: 1 });
    const foliageMaterial = new THREE.MeshStandardMaterial({ color: COLORS.tree, roughness: 1 });
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: COLORS.trunk, roughness: 1 });
    const canopyGeometry = new THREE.IcosahedronGeometry(2.1, 1);
    const trunkGeometry = new THREE.CylinderGeometry(0.22, 0.35, 2.7, 6);
    let buildingCount = 0;
    let treeCount = 0;

    // A deterministic street model supplies scale without claiming real buildings.
    for (let row = 0; row < 6; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        const seed = (sceneSeed + row * 19 + column * 31 + 7) % 17;
        const x = (column / 7 - 0.5) * (width - 14);
        const z = (row / 5 - 0.5) * (depth - 14);
        const point = new THREE.Vector3(x, 0, z);
        if (isNearRoute(point, pathPoints, 10)) continue;
        if (seed % 3 === 0 && buildingCount < 19) {
          const buildingWidth = 6 + seed % 5;
          const buildingDepth = 6 + (seed * 3) % 5;
          const buildingHeight = 4.6 + (seed % 5) * 1.35;
          const angle = ((seed % 4) - 1.5) * 0.15;
          const buildingMaterial = buildingMaterials[(seed + row) % buildingMaterials.length];
          const roofMaterial = roofMaterials[(seed + column) % roofMaterials.length];
          addBox(buildingWidth + 2, 0.25, buildingDepth + 2, pavementMaterial, x, 0.125, z);
          const body = addBox(buildingWidth, buildingHeight, buildingDepth, buildingMaterial, x, buildingHeight / 2 + 0.25, z);
          body.rotation.y = angle;
          const roof = addBox(buildingWidth + 0.3, 0.45, buildingDepth + 0.3, roofMaterial, x, buildingHeight + 0.5, z);
          roof.rotation.y = angle;
          addFacadeWindows({ width: buildingWidth, height: buildingHeight, depth: buildingDepth, x, z, angle, seed });
          buildingCount += 1;
        } else if (treeCount < 20) {
          const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
          trunk.position.set(x, 1.45, z);
          const canopy = new THREE.Mesh(canopyGeometry, foliageMaterial);
          canopy.position.set(x, 4.3, z);
          canopy.scale.y = 1.2 + (seed % 3) * 0.1;
          trunk.castShadow = true;
          canopy.castShadow = true;
          routeGroup.add(trunk, canopy);
          treeCount += 1;
        }
      }
    }

    (stops || []).forEach((stop, index) => addLandmarkFeature(stop, points[index], index, points));

    const north = createTextSprite('N');
    if (north) {
      north.position.set(-width / 2 + 6, 1.2, -depth / 2 + 2);
      north.scale.set(3.2, 1.6, 1);
      routeGroup.add(north);
    }
    const label = createTextSprite('\u7a7a\u95f4\u793a\u610f \u00b7 \u5efa\u7b51\u975e\u771f\u5b9e\u5efa\u6a21');
    if (label) {
      label.position.set(0, 0.7, depth / 2 - 2);
      label.scale.multiplyScalar(0.77);
      routeGroup.add(label);
    }
  }

  function addRoad(points, pathPoints = points) {
    const streetMaterial = new THREE.MeshStandardMaterial({ color: COLORS.street, roughness: 1 });
    const pavementMaterial = new THREE.MeshStandardMaterial({ color: COLORS.pavement, roughness: 1 });
    const lineMaterial = new THREE.MeshStandardMaterial({ color: COLORS.route, roughness: 0.5 });
    const distinctPoints = pathPoints.filter((point, index) => index === 0 || point.distanceTo(pathPoints[index - 1]) > 0.05);
    distinctPoints.forEach((point, index) => {
      const joint = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.14, 20), streetMaterial);
      joint.position.set(point.x, 0.22, point.z);
      joint.receiveShadow = true;
      routeGroup.add(joint);
      if (index === 0) return;
      const previous = distinctPoints[index - 1];
      const distance = point.distanceTo(previous);
      const middle = point.clone().add(previous).multiplyScalar(0.5);
      const angle = -Math.atan2(point.z - previous.z, point.x - previous.x);
      const sidewalk = addBox(distance, 0.13, 6.2, pavementMaterial, middle.x, 0.08, middle.z);
      const street = addBox(distance, 0.13, 4.5, streetMaterial, middle.x, 0.2, middle.z);
      sidewalk.rotation.y = angle;
      street.rotation.y = angle;
      sidewalk.castShadow = false;
      street.castShadow = false;
    });

    routeCurve = null;
    routeLength = 0;
    traveler = null;
    walkDistance = 0;
    if (distinctPoints.length < 2) return;
    routeCurve = new THREE.CurvePath();
    distinctPoints.slice(1).forEach((point, index) => {
      const start = distinctPoints[index].clone().setY(0.46);
      const end = point.clone().setY(0.46);
      routeCurve.add(new THREE.LineCurve3(start, end));
    });
    routeLength = routeCurve.getLength();
    const line = new THREE.Mesh(new THREE.TubeGeometry(routeCurve, Math.max(64, distinctPoints.length * 16), 0.3, 8, false), lineMaterial);
    routeGroup.add(line);
    traveler = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x7df1ed, emissiveIntensity: 0.7 }));
    const halo = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 32), new THREE.MeshBasicMaterial({ color: COLORS.route, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.6;
    traveler.add(core, halo);
    routeGroup.add(traveler);
  }

  function addStops(stops, points) {
    stopObjects = [];
    clickTargets = [];
    stops.forEach((stop, index) => {
      const group = new THREE.Group();
      group.position.copy(points[index]);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.75, 0.75, 24), new THREE.MeshStandardMaterial({ color: COLORS.route, roughness: 0.65 }));
      base.position.y = 0.65;
      base.castShadow = true;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 5.3, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
      stem.position.y = 3.4;
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.3, 2.8, 40), new THREE.MeshBasicMaterial({ color: COLORS.active, transparent: true, opacity: 0.82, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.3;
      const marker = createTextSprite(String(index + 1), { number: true });
      const activeMarker = createTextSprite(String(index + 1), { number: true, active: true });
      const label = createTextSprite(String(stop?.name || `Stop ${index + 1}`));
      [marker, activeMarker].filter(Boolean).forEach(sprite => {
        sprite.position.y = 7.5;
        sprite.userData.stopIndex = index;
        group.add(sprite);
        clickTargets.push(sprite);
      });
      if (label) {
        label.position.set(0, 11.4, 0);
        group.add(label);
      }
      base.userData.stopIndex = index;
      clickTargets.push(base);
      group.add(base, stem, ring);
      routeGroup.add(group);
      stopObjects.push({ group, base, ring, marker, activeMarker, label });
    });
  }

  function setActiveStop(index) {
    if (disposed || !stopObjects.length) return;
    activeIndex = Math.min(stopObjects.length - 1, Math.max(0, Math.trunc(Number(index) || 0)));
    stopObjects.forEach((stop, stopIndex) => {
      const active = stopIndex === activeIndex;
      stop.base.material.color.set(active ? COLORS.active : COLORS.route);
      stop.ring.visible = active;
      stop.ring.scale.setScalar(1);
      if (stop.marker) stop.marker.visible = !active;
      if (stop.activeMarker) stop.activeMarker.visible = active;
      if (stop.label) {
        stop.label.material.opacity = active ? 1 : 0.83;
        stop.label.visible = active || stopObjects.length <= 4;
      }
    });
    requestFrame();
  }

  function setRoute(route) {
    if (disposed) return;
    const stops = Array.isArray(route?.stops) ? route.stops : [];
    const preserveActiveStop = renderedRoute === route;
    const nextActiveIndex = preserveActiveStop ? activeIndex : 0;
    disposeGroup(routeGroup);
    const projection = projectStops(stops, route);
    routePoints = projection.points;
    walkingRoutePoints = projection.walkingPoints || routePoints;
    routeDimensions = { width: projection.width, depth: projection.depth };
    coordinateMode = projection.hasCoordinates ? 'coordinates' : 'schematic';
    const sceneSeed = hashString([
      route?.city,
      route?.title,
      ...(stops || []).map(stop => `${stop?.name || ''}:${stop?.type || ''}`)
    ].join('|'));
    addContext(routePoints, projection.width, projection.depth, stops, sceneSeed, walkingRoutePoints);
    addRoad(routePoints, walkingRoutePoints);
    addStops(stops, routePoints);
    renderedRoute = route;
    setActiveStop(nextActiveIndex);
    resize();
    fitCamera();
    requestFrame();
  }

  function stopAnimation() {
    if (frameId) window.cancelAnimationFrame(frameId);
    frameId = 0;
    frameTime = 0;
  }

  function setVisible(nextVisible) {
    if (disposed) return;
    visible = Boolean(nextVisible);
    controls.enabled = visible;
    if (visible) {
      resize();
      requestFrame();
    } else {
      stopAnimation();
    }
  }

  function resetCamera() {
    if (disposed) return;
    fitCamera();
    requestFrame();
  }

  function pickStop(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(clickTargets.filter(target => target.visible), false)[0];
    return typeof hit?.object?.userData?.stopIndex === 'number' ? hit.object.userData.stopIndex : null;
  }

  function handlePointerDown(event) {
    pointerDown = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  }

  function handlePointerUp(event) {
    if (!pointerDown || pointerDown.pointerId !== event.pointerId) return;
    const travel = Math.hypot(pointerDown.x - event.clientX, pointerDown.y - event.clientY);
    pointerDown = null;
    if (travel > 7) return;
    const index = pickStop(event);
    if (index == null) return;
    setActiveStop(index);
    onSelect?.(index);
  }

  function handlePointerMove(event) {
    if (pointerDown || event.pointerType === 'touch') return;
    renderer.domElement.style.cursor = pickStop(event) == null ? 'grab' : 'pointer';
  }

  function handlePointerCancel() {
    pointerDown = null;
  }

  function handleContextLost(event) {
    event.preventDefault();
    contextLost = true;
    stopAnimation();
    onError?.(new Error('The WebGL context was lost. Use the 2D route preview.'));
  }

  function handleContextRestored() {
    contextLost = false;
    requestFrame();
  }

  function handleVisibility() {
    if (document.hidden) stopAnimation();
    else requestFrame();
  }

  function handleKeyDown(event) {
    if (event.key === 'Home') {
      event.preventDefault();
      resetCamera();
    } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && stopObjects.length) {
      event.preventDefault();
      const change = event.key === 'ArrowLeft' ? -1 : 1;
      setActiveStop((activeIndex + change + stopObjects.length) % stopObjects.length);
      onSelect?.(activeIndex);
    }
  }

  renderer.domElement.addEventListener('pointerdown', handlePointerDown);
  renderer.domElement.addEventListener('pointerup', handlePointerUp);
  renderer.domElement.addEventListener('pointermove', handlePointerMove);
  renderer.domElement.addEventListener('pointercancel', handlePointerCancel);
  renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
  renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);
  renderer.domElement.addEventListener('keydown', handleKeyDown);
  document.addEventListener('visibilitychange', handleVisibility);
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(container);
  if (!resizeObserver) window.addEventListener('resize', resize);
  resize();

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopAnimation();
    resizeObserver?.disconnect();
    if (!resizeObserver) window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', handleVisibility);
    renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
    renderer.domElement.removeEventListener('pointerup', handlePointerUp);
    renderer.domElement.removeEventListener('pointermove', handlePointerMove);
    renderer.domElement.removeEventListener('pointercancel', handlePointerCancel);
    renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
    renderer.domElement.removeEventListener('keydown', handleKeyDown);
    controls.dispose();
    disposeGroup(routeGroup);
    sunlight.shadow.map?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }

  return { available: true, setRoute, setActiveStop, setVisible, resetCamera, dispose };
}
