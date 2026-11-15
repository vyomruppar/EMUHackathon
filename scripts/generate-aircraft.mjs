// Original neutral twin-jet model. Metres, glTF Y-up, nose along +Z.
// The +Z forward axis is required by Cesium's glTF model-axis correction.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const materials = [
  [0.94, 0.96, 0.97, 1], // pearl fuselage
  [0.23, 0.37, 0.48, 1], // graphite-blue wing surfaces
  [0.035, 0.12, 0.18, 1], // cockpit glass and engine inlets
  [0.72, 0.91, 0.12, 1], // restrained wing-tip safety accents
  [0.64, 0.74, 0.80, 1], // engine nacelles and trim
];
const groups = materials.map(() => ({ position: [], normal: [] }));
const normalize = v => {
  const m = Math.hypot(...v) || 1;
  return v.map(n => n / m);
};
function triangle(a, b, c, material, normals) {
  const u = b.map((v, i) => v - a[i]);
  const v = c.map((x, i) => x - a[i]);
  const face = normalize([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
  for (const [i, p] of [a, b, c].entries()) {
    groups[material].position.push(...p);
    groups[material].normal.push(...(normals?.[i] ?? face));
  }
}
function quad(a, b, c, d, material, normals) {
  triangle(a, b, c, material, normals && [normals[0], normals[1], normals[2]]);
  triangle(a, c, d, material, normals && [normals[0], normals[2], normals[3]]);
}
function prism(outline, y0, y1, material) {
  for (let i = 1; i < outline.length - 1; i++) {
    triangle([outline[0][0], y1, outline[0][1]], [outline[i][0], y1, outline[i][1]], [outline[i + 1][0], y1, outline[i + 1][1]], material);
    triangle([outline[i + 1][0], y0, outline[i + 1][1]], [outline[i][0], y0, outline[i][1]], [outline[0][0], y0, outline[0][1]], material);
  }
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], material);
  }
}

// A smooth elliptical loft. Every station is [z, half-width, half-height, centre-y].
function fuselage(stations, material, sides = 48, centerX = 0) {
  for (let s = 0; s < stations.length - 1; s++) {
    const [z0, rx0, ry0, cy0] = stations[s], [z1, rx1, ry1, cy1] = stations[s + 1];
    for (let i = 0; i < sides; i++) {
      const a = 2 * Math.PI * i / sides, b = 2 * Math.PI * (i + 1) / sides;
      const point = (z, rx, ry, cy, angle) => [centerX + rx * Math.cos(angle), cy + ry * Math.sin(angle), z];
      const normal = (rx, ry, dx, dy, angle) => normalize([ry * Math.cos(angle), rx * Math.sin(angle), -(dy * Math.sin(angle) + dx * Math.cos(angle)) * 0.5]);
      const dx = (rx1 - rx0) / (z1 - z0), dy = (ry1 - ry0) / (z1 - z0);
      const p00 = point(z0, rx0, ry0, cy0, a), p01 = point(z0, rx0, ry0, cy0, b);
      const p11 = point(z1, rx1, ry1, cy1, b), p10 = point(z1, rx1, ry1, cy1, a);
      quad(p00, p01, p11, p10, material, [normal(rx0, ry0, dx, dy, a), normal(rx0, ry0, dx, dy, b), normal(rx1, ry1, dx, dy, b), normal(rx1, ry1, dx, dy, a)]);
    }
  }
}

// Swept, subtly cambered wing surface, mirrored about the fuselage centreline.
function wing(side, { span, rootLeading, rootTrailing, tipLeading, tipTrailing, y, material }) {
  const spanSteps = Math.ceil(span / 0.7), chordSteps = 10;
  for (let i = 0; i < spanSteps; i++) {
    const u0 = i / spanSteps, u1 = (i + 1) / spanSteps;
    const x0 = side * span * u0, x1 = side * span * u1;
    const lead0 = rootLeading + (tipLeading - rootLeading) * u0, lead1 = rootLeading + (tipLeading - rootLeading) * u1;
    const trail0 = rootTrailing + (tipTrailing - rootTrailing) * u0, trail1 = rootTrailing + (tipTrailing - rootTrailing) * u1;
    for (let j = 0; j < chordSteps; j++) {
      const v0 = j / chordSteps, v1 = (j + 1) / chordSteps;
      const chord0 = trail0 - lead0, chord1 = trail1 - lead1;
      const at = (x, lead, chord, v) => {
        const camber = 0.13 * Math.sin(Math.PI * v);
        const thickness = 0.035 * chord * Math.sin(Math.PI * v);
        return [x, y + camber + thickness, lead - chord * v];
      };
      const upper = [at(x0, lead0, chord0, v0), at(x1, lead1, chord1, v0), at(x1, lead1, chord1, v1), at(x0, lead0, chord0, v1)];
      const upperNormals = upper.map(() => side < 0 ? [0, 1, 0] : [0, 1, 0]);
      quad(...upper, material, upperNormals);
      const lower = upper.map(([x, yy, z]) => [x, 2 * y - yy, z]);
      quad(lower[3], lower[2], lower[1], lower[0], material, lower.map(() => [0, -1, 0]));
    }
  }
  // Close the wing edges with a thin, darker airfoil band.
  const outline = [[0, rootLeading], [side * span, tipLeading], [side * span, tipTrailing], [0, rootTrailing]];
  for (let i = 0; i < outline.length; i++) {
    const [x0, z0] = outline[i], [x1, z1] = outline[(i + 1) % outline.length];
    const chord0 = Math.abs(rootTrailing - rootLeading) + (Math.abs(tipTrailing - tipLeading) - Math.abs(rootTrailing - rootLeading)) * Math.abs(x0) / span;
    const chord1 = Math.abs(rootTrailing - rootLeading) + (Math.abs(tipTrailing - tipLeading) - Math.abs(rootTrailing - rootLeading)) * Math.abs(x1) / span;
    const t0 = Math.min(0.38, chord0 * 0.035), t1 = Math.min(0.38, chord1 * 0.035);
    quad([x0, y - t0, z0], [x1, y - t1, z1], [x1, y + t1, z1], [x0, y + t0, z0], material);
  }
}

// 39 m body length, 36 m wingspan. Nose is +Z; wing tips extend to +/-18 m.
const bodyProfile = [
  [-19.5, 0.06, 0.07, 1.72], [-18.6, 0.42, 0.46, 1.72], [-16.5, 0.9, 0.82, 1.72],
  [-13, 1.25, 1.08, 1.72], [-8, 1.6, 1.38, 1.72], [-2, 1.78, 1.5, 1.72],
  [5, 1.78, 1.48, 1.72], [10, 1.55, 1.28, 1.72], [14, 1.15, 0.94, 1.72],
  [17, 0.65, 0.57, 1.72], [19.5, 0.04, 0.04, 1.72],
];
fuselage(bodyProfile, 0, 48);

function bodyPoint(z, side, upperRatio, lift = 0.018) {
  let index = bodyProfile.findIndex((station, i) => i < bodyProfile.length - 1 && z >= station[0] && z <= bodyProfile[i + 1][0]);
  if (index < 0) index = z < bodyProfile[0][0] ? 0 : bodyProfile.length - 2;
  const a = bodyProfile[index], b = bodyProfile[index + 1];
  const t = Math.max(0, Math.min(1, (z - a[0]) / (b[0] - a[0])));
  const rx = a[1] + (b[1] - a[1]) * t;
  const ry = a[2] + (b[2] - a[2]) * t;
  const cy = a[3] + (b[3] - a[3]) * t;
  const vertical = Math.max(-0.98, Math.min(0.98, upperRatio));
  const x = rx * Math.sqrt(1 - vertical * vertical);
  return [side * x, cy + ry * vertical + lift, z];
}

for (const side of [-1, 1]) {
  wing(side, { span: 18, rootLeading: 4.7, rootTrailing: -2.7, tipLeading: -2.5, tipTrailing: -4.5, y: 1.58, material: 1 });
  // Horizontal stabilizer: shorter span, stronger sweep, near the tail.
  wing(side, { span: 7.4, rootLeading: -13.3, rootTrailing: -18.5, tipLeading: -16.4, tipTrailing: -18.9, y: 2.0, material: 1 });

  // Slim swept winglet.
  const x = side * 17.65;
  quad([x, 1.58, -4.5], [side * 18, 1.58, -4.35], [side * 17.82, 3.45, -2.55], [x, 3.05, -2.9], 1);
  quad([side * 18, 1.58, -4.35], [x, 1.58, -4.5], [x, 3.05, -2.9], [side * 17.82, 3.45, -2.55], 1);
  quad([side * 17.84, 1.55, -4.5], [side * 18, 1.55, -4.5], [side * 18, 1.59, -2.5], [side * 17.84, 1.59, -2.5], 3);

  // Under-wing pylons and smooth turbofan nacelles; the inlets face the nose (+Z).
  prism([[side * 5.0, 1.35], [side * 7.8, 1.35], [side * 7.2, -1.5], [side * 5.4, -1.5]], 0.9, 1.52, 4);
  fuselage([
    [-4.2, 0.62, 0.6, 0.61], [-3.8, 0.78, 0.73, 0.61], [-3.2, 0.86, 0.8, 0.61],
    [-1.8, 0.91, 0.86, 0.61], [0.8, 0.91, 0.86, 0.61], [2.4, 0.82, 0.77, 0.61],
    [3.0, 0.64, 0.61, 0.61], [3.1, 0.56, 0.53, 0.61],
  ], 4, 32, side * 6.6);
  // Dark recessed fan opening, surrounded by a metallic inlet lip.
  const inletX = side * 6.6, inletY = 0.61, inletR = 0.56, inletZ = 3.06;
  for (let i = 0; i < 32; i++) {
    const a = 2 * Math.PI * i / 32, b = 2 * Math.PI * (i + 1) / 32;
    triangle([inletX, inletY, inletZ], [inletX + inletR * Math.cos(a), inletY + inletR * Math.sin(a), inletZ], [inletX + inletR * Math.cos(b), inletY + inletR * Math.sin(b), inletZ], 2, [[0, 0, 1], [0, 0, 1], [0, 0, 1]]);
    quad([inletX + 0.56 * Math.cos(a), inletY + 0.56 * Math.sin(a), inletZ], [inletX + 0.63 * Math.cos(a), inletY + 0.63 * Math.sin(a), inletZ], [inletX + 0.63 * Math.cos(b), inletY + 0.63 * Math.sin(b), inletZ], [inletX + 0.56 * Math.cos(b), inletY + 0.56 * Math.sin(b), inletZ], 4);
  }
  // Exhaust opening and fan hub give the engine a readable 3D end profile.
  const exhaustZ = -4.18, exhaustR = 0.57;
  for (let i = 0; i < 32; i++) {
    const a = 2 * Math.PI * i / 32, b = 2 * Math.PI * (i + 1) / 32;
    triangle([inletX, inletY, exhaustZ], [inletX + exhaustR * Math.cos(a), inletY + exhaustR * Math.sin(a), exhaustZ], [inletX + exhaustR * Math.cos(b), inletY + exhaustR * Math.sin(b), exhaustZ], 2, [[0, 0, -1], [0, 0, -1], [0, 0, -1]]);
    const hubR = 0.13;
    triangle([inletX, inletY, exhaustZ - 0.01], [inletX + hubR * Math.cos(a), inletY + hubR * Math.sin(a), exhaustZ - 0.01], [inletX + hubR * Math.cos(b), inletY + hubR * Math.sin(b), exhaustZ - 0.01], 4, [[0, 0, -1], [0, 0, -1], [0, 0, -1]]);
  }
}

// Swept vertical fin with a broad root and narrow tip.
const finSide = 0.16;
const finOutline = [[-17.5, 1.9], [-11.6, 2.5], [-15.4, 7.2], [-17.2, 6.6]];
for (const side of [-1, 1]) {
  for (let i = 1; i < finOutline.length - 1; i++) {
    const [[z0, y0], [z1, y1], [z2, y2]] = [finOutline[0], finOutline[i], finOutline[i + 1]];
    triangle([side * finSide, y0, z0], [side * finSide, y1, z1], [side * finSide, y2, z2], 1);
  }
}
for (let i = 0; i < finOutline.length; i++) {
  const [z0, y0] = finOutline[i], [z1, y1] = finOutline[(i + 1) % finOutline.length];
  quad([-finSide, y0, z0], [finSide, y0, z0], [finSide, y1, z1], [-finSide, y1, z1], 1);
}

// Cockpit glazing follows the curved upper fuselage instead of floating above it.
for (const side of [-1, 1]) {
  quad(bodyPoint(13.6, side, 0.66), bodyPoint(13.6, side, 0.91), bodyPoint(16.5, side, 0.77), bodyPoint(16.5, side, 0.42), 2);
}
// Evenly spaced cabin windows sit tangent to the rounded upper sides of the fuselage.
for (const side of [-1, 1]) {
  for (let i = 0; i < 11; i++) {
    const z = -7.2 + i * 1.45;
    quad(bodyPoint(z, side, 0.22), bodyPoint(z + 0.74, side, 0.22), bodyPoint(z + 0.74, side, 0.42), bodyPoint(z, side, 0.42), 2);
  }
}

// Small neutral wingtip accents reinforce the aircraft's direction at close zoom.
prism([[16.9, -2.55], [17.7, -2.62], [17.7, -4.52], [16.9, -4.5]], 1.56, 1.66, 3);
prism([[-17.7, -2.62], [-16.9, -2.55], [-16.9, -4.5], [-17.7, -4.52]], 1.56, 1.66, 3);

const chunks = [], bufferViews = [], accessors = [], primitives = [];
let offset = 0;
function accessor(values, target, minmax = false) {
  const data = Buffer.from(new Float32Array(values).buffer);
  chunks.push(data);
  const view = bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length, target }) - 1;
  offset += data.length;
  const entry = { bufferView: view, componentType: 5126, count: values.length / 3, type: "VEC3" };
  if (minmax) {
    entry.min = [Infinity, Infinity, Infinity];
    entry.max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < values.length; i += 3) for (let axis = 0; axis < 3; axis++) {
      entry.min[axis] = Math.min(entry.min[axis], values[i + axis]);
      entry.max[axis] = Math.max(entry.max[axis], values[i + axis]);
    }
  }
  return accessors.push(entry) - 1;
}
groups.forEach((group, material) => {
  const position = accessor(group.position, 34962, true);
  const normal = accessor(group.normal, 34962);
  primitives.push({ attributes: { POSITION: position, NORMAL: normal }, material, mode: 4 });
});
const gltf = {
  asset: { version: "2.0", generator: "AIRSPACE original generic twin-jet mesh, 2026" },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives }],
  materials: materials.map((c, i) => ({ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: c, metallicFactor: i === 0 || i === 4 ? 0.28 : 0.12, roughnessFactor: i === 2 ? 0.28 : 0.54 } })),
  buffers: [{ byteLength: offset }], bufferViews, accessors,
};
const json = Buffer.from(JSON.stringify(gltf));
const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const binary = Buffer.concat(chunks);
const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binary.length, 8);
jsonHeader.writeUInt32LE(jsonPadded.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
const dest = join(root, "public/models/airspace-generic.glb");
await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binary]));
console.log("Generated original, smooth generic twin-jet model (39 m x 36 m).");
