import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Octree } from 'three/addons/math/Octree.js';
import { OctreeHelper } from 'three/addons/helpers/OctreeHelper.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

// --- Temporizador ---
const timer = new THREE.Timer();
timer.connect(document);

// --- Escena ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x88ccee);
scene.fog = new THREE.Fog(0x88ccee, 0, 50);

// --- Cámara ---
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.rotation.order = 'YXZ';

// --- Luces ---
const fillLight1 = new THREE.HemisphereLight(0x8dc1de, 0x00668d, 1.5);
fillLight1.position.set(2, 1, 1);
scene.add(fillLight1);

const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5);
directionalLight.position.set(-5, 25, -1);
directionalLight.castShadow = true;
directionalLight.shadow.camera.near = 0.01;
directionalLight.shadow.camera.far = 500;
directionalLight.shadow.camera.right = 30;
directionalLight.shadow.camera.left = -30;
directionalLight.shadow.camera.top = 30;
directionalLight.shadow.camera.bottom = -30;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
directionalLight.shadow.radius = 4;
directionalLight.shadow.bias = -0.00006;
scene.add(directionalLight);

// --- Renderer ---
const container = document.getElementById('container');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setAnimationLoop(animate);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
container.appendChild(renderer.domElement);

// --- Estadísticas (FPS) ---
const stats = new Stats();
stats.domElement.style.position = 'fixed';
stats.domElement.style.top = '60px';
stats.domElement.style.left = '0';
stats.domElement.style.zIndex = '300';
document.body.appendChild(stats.domElement);

// --- Constantes globales ---
const GRAVITY = 30;
const RESTITUTION = 0.7;
const NUM_SPHERES = 100;
const SPHERE_RADIUS = 0.2;
const STEPS_PER_FRAME = 5;

// --- Contador de bolas recolectadas ---
let score = 0;
const scoreElement = document.getElementById('score');

// --- Sistema de partículas para lanzamiento ---
const particleCount = 20;
const particleGeometry = new THREE.BufferGeometry();
const particlePositions = new Float32Array(particleCount * 3);
const particleColors = new Float32Array(particleCount * 3);
particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
particleGeometry.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

const particleMaterial = new THREE.PointsMaterial({
    size: 0.1,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending
});
const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
scene.add(particleSystem);

let particlesActive = false;
let particleLifetime = 0;
const particleMaxLifetime = 0.5; // segundos
let particleVelocities = [];

// --- Creación de las bolas (inicialmente inactivas) ---
const sphereGeometry = new THREE.IcosahedronGeometry(SPHERE_RADIUS, 5);
const sphereMaterial = new THREE.MeshLambertMaterial({ color: 0xdede8d });

const spheres = [];
let sphereIdx = 0;

for (let i = 0; i < NUM_SPHERES; i++) {
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    sphere.visible = false; // ocultas al inicio
    scene.add(sphere);

    spheres.push({
        mesh: sphere,
        collider: new THREE.Sphere(new THREE.Vector3(0, -100, 0), SPHERE_RADIUS),
        velocity: new THREE.Vector3(),
        active: false      // inactiva inicialmente
    });
}

// --- Octree del mundo (se llenará al cargar el modelo) ---
const worldOctree = new Octree();

// --- Colisionador del jugador (cápsula) ---
const playerCollider = new Capsule(new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(0, 1, 0), 0.35);

// --- Variables de movimiento del jugador ---
const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();
let playerOnFloor = false;
let mouseTime = 0;
const keyStates = {};

// --- Vectores auxiliares para cálculos ---
const vector1 = new THREE.Vector3();
const vector2 = new THREE.Vector3();
const vector3 = new THREE.Vector3();

// --- Eventos de teclado ---
document.addEventListener('keydown', (event) => {
    keyStates[event.code] = true;
});
document.addEventListener('keyup', (event) => {
    keyStates[event.code] = false;
});

// --- Eventos de mouse (lanzar bolas) ---
container.addEventListener('mousedown', () => {
    document.body.requestPointerLock();
    mouseTime = performance.now();
});
document.addEventListener('mouseup', () => {
    if (document.pointerLockElement !== null) throwBall();
});

// --- Movimiento de la cámara con el mouse ---
document.body.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === document.body) {
        camera.rotation.y -= event.movementX / 500;
        camera.rotation.x -= event.movementY / 500;
    }
});

// --- Redimensionar ventana ---
window.addEventListener('resize', onWindowResize);
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Función para generar partículas al lanzar ---
function spawnParticles(position, direction) {
    const count = particleCount;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    particleVelocities = [];

    for (let i = 0; i < count; i++) {
        // Posición inicial aleatoria alrededor del punto de lanzamiento
        const offset = new THREE.Vector3(
            (Math.random() - 0.5) * 0.3,
            (Math.random() - 0.5) * 0.3,
            (Math.random() - 0.5) * 0.3
        );
        const pos = position.clone().add(offset);
        positions[i * 3] = pos.x;
        positions[i * 3 + 1] = pos.y;
        positions[i * 3 + 2] = pos.z;

        // Color amarillo/naranja aleatorio
        const color = new THREE.Color().setHSL(0.1 + Math.random() * 0.1, 1, 0.5 + Math.random() * 0.3);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;

        // Velocidad: mezcla de la dirección del lanzamiento (invertida) más aleatoriedad
        const vel = direction.clone().multiplyScalar(2 + Math.random() * 3);
        vel.x += (Math.random() - 0.5) * 2;
        vel.y += (Math.random() - 0.5) * 2;
        vel.z += (Math.random() - 0.5) * 2;
        particleVelocities.push(vel);
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    particlesActive = true;
    particleLifetime = 0;
    particleSystem.visible = true;
}

// --- Lanzar bola (activar una bola y generar partículas) ---
function throwBall() {
    const sphere = spheres[sphereIdx];
    sphere.active = true;
    sphere.mesh.visible = true;

    camera.getWorldDirection(playerDirection);

    sphere.collider.center.copy(playerCollider.end).addScaledVector(playerDirection, playerCollider.radius * 1.5);

    const impulse = 15 + 30 * (1 - Math.exp((mouseTime - performance.now()) * 0.001));
    sphere.velocity.copy(playerDirection).multiplyScalar(impulse);
    sphere.velocity.addScaledVector(playerVelocity, 2);

    // Generar partículas en dirección opuesta al lanzamiento
    spawnParticles(sphere.collider.center.clone(), playerDirection.clone().multiplyScalar(-0.5));

    sphereIdx = (sphereIdx + 1) % spheres.length;
}

// --- Colisiones del jugador con el mundo ---
function playerCollisions() {
    const result = worldOctree.capsuleIntersect(playerCollider);
    playerOnFloor = false;
    if (result) {
        playerOnFloor = result.normal.y > 0;
        if (!playerOnFloor) {
            playerVelocity.addScaledVector(result.normal, -result.normal.dot(playerVelocity));
        }
        if (result.depth >= 1e-10) {
            playerCollider.translate(result.normal.multiplyScalar(result.depth));
        }
    }
}

// --- Actualizar jugador (física y movimiento) ---
function updatePlayer(deltaTime) {
    let damping = Math.exp(-4 * deltaTime) - 1;
    if (!playerOnFloor) {
        playerVelocity.y -= GRAVITY * deltaTime;
        damping *= 0.1;
    }
    playerVelocity.addScaledVector(playerVelocity, damping);
    const deltaPosition = playerVelocity.clone().multiplyScalar(deltaTime);
    playerCollider.translate(deltaPosition);
    playerCollisions();
    camera.position.copy(playerCollider.end);
}

// --- Colisión jugador-bola (recolectar) ---
function playerSphereCollision(sphere) {
    if (!sphere.active) return;

    const center = vector1.addVectors(playerCollider.start, playerCollider.end).multiplyScalar(0.5);
    const sphere_center = sphere.collider.center;
    const r = playerCollider.radius + sphere.collider.radius;
    const r2 = r * r;

    for (const point of [playerCollider.start, playerCollider.end, center]) {
        const d2 = point.distanceToSquared(sphere_center);
        if (d2 < r2) {
            // Recolectar bola
            score++;
            scoreElement.innerText = `Bolas recolectadas: ${score}`;

            // Desactivar bola
            sphere.active = false;
            sphere.mesh.visible = false;
            sphere.collider.center.set(0, -100, 0);
            sphere.velocity.set(0, 0, 0);
            return; // Salir sin procesar más colisiones para esta bola
        }
    }
}

// --- Colisiones entre bolas ---
function spheresCollisions() {
    for (let i = 0, length = spheres.length; i < length; i++) {
        const s1 = spheres[i];
        if (!s1.active) continue;
        for (let j = i + 1; j < length; j++) {
            const s2 = spheres[j];
            if (!s2.active) continue;

            const d2 = s1.collider.center.distanceToSquared(s2.collider.center);
            const r = s1.collider.radius + s2.collider.radius;
            const r2 = r * r;

            if (d2 < r2) {
                const normal = vector1.subVectors(s1.collider.center, s2.collider.center).normalize();
                const v1 = vector2.copy(normal).multiplyScalar(normal.dot(s1.velocity));
                const v2 = vector3.copy(normal).multiplyScalar(normal.dot(s2.velocity));

                s1.velocity.add(v2).sub(v1);
                s2.velocity.add(v1).sub(v2);

                const d = (r - Math.sqrt(d2)) / 2;
                s1.collider.center.addScaledVector(normal, d);
                s2.collider.center.addScaledVector(normal, -d);
            }
        }
    }
}

// --- Actualizar bolas (física, colisiones con el mundo y entre ellas) ---
function updateSpheres(deltaTime) {
    spheres.forEach(sphere => {
        if (!sphere.active) return;

        sphere.collider.center.addScaledVector(sphere.velocity, deltaTime);

        const result = worldOctree.sphereIntersect(sphere.collider);

        if (result) {
            const vNormal = result.normal.dot(sphere.velocity);
            sphere.velocity.addScaledVector(result.normal, -vNormal * (1 + RESTITUTION));
            sphere.collider.center.add(result.normal.multiplyScalar(result.depth));
        } else {
            sphere.velocity.y -= GRAVITY * deltaTime;
        }

        const damping = Math.exp(-1.5 * deltaTime) - 1;
        sphere.velocity.addScaledVector(sphere.velocity, damping);

        playerSphereCollision(sphere);
    });

    spheresCollisions();

    for (const sphere of spheres) {
        if (sphere.active) {
            sphere.mesh.position.copy(sphere.collider.center);
        }
    }
}

// --- Vectores de movimiento relativos a la cámara ---
function getForwardVector() {
    camera.getWorldDirection(playerDirection);
    playerDirection.y = 0;
    playerDirection.normalize();
    return playerDirection;
}

function getSideVector() {
    camera.getWorldDirection(playerDirection);
    playerDirection.y = 0;
    playerDirection.normalize();
    playerDirection.cross(camera.up);
    return playerDirection;
}

// --- Controles del jugador (WASD + espacio) ---
function controls(deltaTime) {
    const speedDelta = deltaTime * (playerOnFloor ? 25 : 8);
    if (keyStates['KeyW']) playerVelocity.add(getForwardVector().multiplyScalar(speedDelta));
    if (keyStates['KeyS']) playerVelocity.add(getForwardVector().multiplyScalar(-speedDelta));
    if (keyStates['KeyA']) playerVelocity.add(getSideVector().multiplyScalar(-speedDelta));
    if (keyStates['KeyD']) playerVelocity.add(getSideVector().multiplyScalar(speedDelta));
    if (playerOnFloor && keyStates['Space']) playerVelocity.y = 15;
}

// --- Cargar el modelo del mundo ---
const loader = new GLTFLoader().setPath('./models/gltf/');
loader.load('collision-world.glb', (gltf) => {
    scene.add(gltf.scene);
    worldOctree.fromGraphNode(gltf.scene);
    gltf.scene.traverse(child => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material.map) child.material.map.anisotropy = 4;
        }
    });
    const helper = new OctreeHelper(worldOctree);
    helper.visible = false;
    scene.add(helper);
    const gui = new GUI({ width: 200 });
    gui.domElement.style.position = 'fixed';
    gui.domElement.style.top = '60px';
    gui.domElement.style.right = '0';
    gui.domElement.style.zIndex = '300';
    gui.add({ debug: false }, 'debug').onChange(value => helper.visible = value);
});

// --- Teletransportar jugador si se cae del mundo ---
function teleportPlayerIfOob() {
    if (camera.position.y <= -25) {
        playerCollider.start.set(0, 0.35, 0);
        playerCollider.end.set(0, 1, 0);
        playerCollider.radius = 0.35;
        camera.position.copy(playerCollider.end);
        camera.rotation.set(0, 0, 0);
    }
}

// --- Bucle principal de animación ---
function animate() {
    timer.update();
    const deltaTime = Math.min(0.05, timer.getDelta()) / STEPS_PER_FRAME;

    // Actualizar partículas
    if (particlesActive) {
        particleLifetime += deltaTime * STEPS_PER_FRAME;
        const alpha = 1 - (particleLifetime / particleMaxLifetime);
        if (alpha <= 0) {
            particlesActive = false;
            particleSystem.visible = false;
        } else {
            particleSystem.visible = true;
            const positions = particleGeometry.attributes.position.array;
            for (let i = 0; i < particleCount; i++) {
                positions[i * 3] += particleVelocities[i].x * deltaTime * STEPS_PER_FRAME;
                positions[i * 3 + 1] += particleVelocities[i].y * deltaTime * STEPS_PER_FRAME;
                positions[i * 3 + 2] += particleVelocities[i].z * deltaTime * STEPS_PER_FRAME;
            }
            particleGeometry.attributes.position.needsUpdate = true;
            particleMaterial.opacity = alpha;
        }
    }

    // Múltiples sub-pasos para mayor precisión
    for (let i = 0; i < STEPS_PER_FRAME; i++) {
        controls(deltaTime);
        updatePlayer(deltaTime);
        updateSpheres(deltaTime);
        teleportPlayerIfOob();
    }

    // Luz dinámica (rotación)
    const time = performance.now() * 0.001;
    directionalLight.position.x = Math.sin(time * 0.2) * 8;
    directionalLight.position.z = Math.cos(time * 0.2) * 8;

    renderer.render(scene, camera);
    stats.update();
}