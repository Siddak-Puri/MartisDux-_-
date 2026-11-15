// Builds public/models/helmet.glb, the model the loading screen flies into,
// from the source download in source/Helmet.fbx + textures/.
//
// One-off asset build, like the Python scripts beside it. Its tools are not
// project dependencies; from the repo root:
//
//   npm i --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
//   node scripts/build_helmet_model.mjs
//
// What it does: bakes the FBX transforms (Z-up centimetres -> Y-up metres,
// centred on the origin), welds the triangle soup into an indexed mesh, splits
// the glass off as its own node named "Visor" (the loader finds it by that
// name), shrinks the textures to 1024 px WebP and packs the geometry with
// meshopt (the loader registers three's MeshoptDecoder for it).
//
// The source's second, black sun visor ("Black-one") is left out: it sits
// retracted inside the shell, where the tinted glass hides it completely.

import { mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, reorder, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'source/Helmet.fbx');
const TEXTURES = path.join(ROOT, 'textures');
const OUTPUT = path.join(ROOT, 'public/models/helmet.glb');
const TEXTURE_SIZE = 1024;
const CM_TO_M = 0.01;

// FBXLoader expects a browser; these are the three things it touches.
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {} }),
};
const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

function parseFbx(file) {
  const bytes = readFileSync(file);
  const warn = console.warn;
  console.warn = () => {}; // "ShininessExponent map is not supported": irrelevant here
  try {
    return new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  } finally {
    console.warn = warn;
  }
}

/** Positions, normals and uvs of one vertex range, with `matrix` baked in. */
function bake(mesh, start, count, matrix) {
  const { position, normal, uv } = mesh.geometry.attributes;
  const world = new THREE.Matrix4().multiplyMatrices(matrix, mesh.matrixWorld);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(position, start + i).applyMatrix4(world).toArray(positions, i * 3);
    v.fromBufferAttribute(normal, start + i).applyMatrix3(normalMatrix).normalize().toArray(normals, i * 3);
    uvs[i * 2] = uv.getX(start + i);
    uvs[i * 2 + 1] = 1 - uv.getY(start + i); // glTF's v axis points down
  }
  return { positions, normals, uvs };
}

const fbx = parseFbx(SOURCE);
fbx.updateMatrixWorld(true);
const shell = fbx.getObjectByName('Helmet-Body');
const groupOf = (name) => {
  const group = shell.geometry.groups.find((g) => shell.material[g.materialIndex].name === name);
  if (!group) throw new Error(`No "${name}" material group in ${SOURCE}`);
  return group;
};
const bodyRange = groupOf('Helmet-Body');
const glassRange = groupOf('helmet_glass');

// Centre on the shell + glass, and go from centimetres to metres.
shell.geometry.computeBoundingBox();
const centre = shell.geometry.boundingBox.clone().applyMatrix4(shell.matrixWorld).getCenter(new THREE.Vector3());
const toOrigin = new THREE.Matrix4()
  .makeScale(CM_TO_M, CM_TO_M, CM_TO_M)
  .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));

const doc = new Document();
doc.createExtension(EXTTextureWebP).setRequired(true);
const buffer = doc.createBuffer();

async function texture(name, file, options) {
  const image = await sharp(path.join(TEXTURES, file))
    .resize(options.size ?? TEXTURE_SIZE, options.size ?? TEXTURE_SIZE, { kernel: 'lanczos3' })
    .webp(options.webp)
    .toBuffer();
  return doc.createTexture(name).setImage(image).setMimeType('image/webp');
}

const bodyMaterial = doc
  .createMaterial('Helmet_Body')
  .setBaseColorTexture(await texture('helmet-base', 'Helmet-Body_Base_Color+Occ.jpeg', { webp: { quality: 80, effort: 6 } }))
  // Normal maps fall apart under 4:2:0 chroma, so keep full-resolution chroma.
  .setNormalTexture(await texture('helmet-normal', 'Helmet-Body_Normal.png', { webp: { quality: 88, effort: 6, smartSubsample: true } }))
  .setEmissiveTexture(await texture('helmet-emissive', 'Helmet-Body_Emissive.png', { size: 512, webp: { lossless: true, effort: 6 } }))
  .setEmissiveFactor([1, 1, 1])
  .setMetallicFactor(0)
  .setRoughnessFactor(0.55);

// A plain dark glass for any other viewer; the loader swaps in its own shader.
const glassMaterial = doc
  .createMaterial('Visor_Glass')
  .setBaseColorFactor([0.012, 0.01, 0.01, 0.72])
  .setAlphaMode('BLEND')
  .setMetallicFactor(0)
  .setRoughnessFactor(0.06);

function part(name, range, material) {
  const { positions, normals, uvs } = bake(shell, range.start, range.count, toOrigin);
  const primitive = doc
    .createPrimitive()
    .setMaterial(material)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normals).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buffer));
  return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(primitive));
}

const helmet = doc
  .createNode('Helmet')
  .addChild(part('Body', bodyRange, bodyMaterial))
  .addChild(part('Visor', glassRange, glassMaterial));
doc.getRoot().setDefaultScene(doc.createScene('Helmet').addChild(helmet));

await MeshoptEncoder.ready;
await doc.transform(
  weld(),
  dedup(),
  prune(),
  reorder({ encoder: MeshoptEncoder }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

mkdirSync(path.dirname(OUTPUT), { recursive: true });
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await io.write(OUTPUT, doc);

for (const mesh of doc.getRoot().listMeshes()) {
  const primitive = mesh.listPrimitives()[0];
  console.log(
    `${mesh.getName().padEnd(6)} ${primitive.getAttribute('POSITION').getCount()} vertices, ${primitive.getIndices().getCount() / 3} triangles`,
  );
}
for (const tex of doc.getRoot().listTextures()) {
  console.log(`${tex.getName().padEnd(16)} ${(tex.getImage().byteLength / 1024).toFixed(1)} kB`);
}
console.log(`${path.relative(ROOT, OUTPUT)}  ${(statSync(OUTPUT).size / 1024).toFixed(1)} kB`);
