import { Cartesian3, Math as CesiumMath, PostProcessStage } from 'cesium';

const fragmentShader = `
  uniform sampler2D colorTexture;
  uniform vec3 u_cameraOrigin;
  uniform vec3 u_cameraRight;
  uniform vec3 u_cameraUp;
  uniform vec3 u_cameraForward;
  uniform float u_tanHalfFovY;
  uniform float u_aspect;
  uniform float u_blend;
  in vec2 v_textureCoordinates;

  vec3 acesDisplayCurve(vec3 value) {
    return clamp((value * (2.51 * value + 0.03)) /
      (value * (2.43 * value + 0.59) + 0.14), 0.0, 1.0);
  }

  void main() {
    vec4 original = texture(colorTexture, v_textureCoordinates);
    vec2 screen = v_textureCoordinates * 2.0 - 1.0;
    vec3 ray = normalize(u_cameraForward +
      u_cameraRight * screen.x * u_tanHalfFovY * u_aspect +
      u_cameraUp * screen.y * u_tanHalfFovY);

    // Position and sphere radius share normalized units, avoiding large-world
    // precision loss in the analytic intersection at orbital camera distances.
    float b = dot(u_cameraOrigin, ray);
    float discriminant = b * b - dot(u_cameraOrigin, u_cameraOrigin) + 1.0;
    vec3 sun = normalize(-0.734 * u_cameraRight +
      0.403 * u_cameraUp - 0.545 * u_cameraForward);
    vec3 result = original.rgb;

    if (discriminant > 0.0 && b < 0.0) {
      float distanceToSurface = -b - sqrt(discriminant);
      if (distanceToSurface > 0.0) {
        vec3 normal = normalize(u_cameraOrigin + ray * distanceToSurface);
        float sunlight = dot(normal, sun);
        float diffuse = max(sunlight, 0.0);
        // Match the supplied MartisDux website's warm display palette. This
        // color transform is confined to the orbital presentation pass.
        vec3 displayColor = clamp(vec3(
          dot(original.rgb, vec3(1.1806, 0.0653, -0.1205)) - 0.0348,
          dot(original.rgb, vec3(0.0587, 0.8132, 0.1578)) - 0.0475,
          dot(original.rgb, vec3(0.0422, -0.2503, 1.1244)) - 0.0402
        ), 0.0, 1.0);
        vec3 linearColor = pow(displayColor, vec3(2.2));
        vec3 lit = linearColor * (0.012 + 1.8 * diffuse) * vec3(1.0, 0.90, 0.78);
        lit = pow(acesDisplayCurve(lit), vec3(1.0 / 2.2));

        float facing = clamp(dot(normal, -ray), 0.0, 1.0);
        float sunward = smoothstep(-0.15, 0.55, sunlight);
        float rim = pow(1.0 - facing, 3.2) * sunward;
        lit += vec3(1.0, 0.32, 0.07) * rim * 0.16;
        result = mix(original.rgb, clamp(lit, 0.0, 1.0), u_blend);
      }
    } else if (b < 0.0) {
      vec3 closestPoint = u_cameraOrigin - ray * b;
      float distanceFromAxis = length(closestPoint);
      if (distanceFromAxis > 1.0 && distanceFromAxis < 1.15) {
        vec3 outward = closestPoint / distanceFromAxis;
        float sunward = smoothstep(-0.05, 0.70, dot(outward, sun));
        float halo = exp(-pow((distanceFromAxis - 1.0) / 0.045, 1.3));
        result += vec3(1.0, 0.25, 0.035) * halo * sunward * 0.22 * u_blend;
      }
    }
    out_FragColor = vec4(result, original.a);
  }
`;

export function createGlobePresentation(viewer, { radius }) {
  const cameraOrigin = new Cartesian3();
  let blend = 0;
  let destroyed = false;
  const stage = viewer.scene.postProcessStages.add(new PostProcessStage({
    name: 'martisdux-orbital-presentation',
    fragmentShader,
    uniforms: {
      u_cameraOrigin: () => Cartesian3.divideByScalar(viewer.camera.positionWC, radius, cameraOrigin),
      u_cameraRight: () => viewer.camera.rightWC,
      u_cameraUp: () => viewer.camera.upWC,
      u_cameraForward: () => viewer.camera.directionWC,
      u_tanHalfFovY: () => Math.tan(viewer.camera.frustum.fovy * 0.5),
      u_aspect: () => viewer.camera.frustum.aspectRatio,
      u_blend: () => blend,
    },
  }));
  stage.enabled = false;

  return {
    update({ mode, height, enabled = true }) {
      if (destroyed) return;
      const amount = CesiumMath.clamp((height - 1_500_000) / 3_500_000, 0, 1);
      const next = enabled && mode === 'viking' ? amount * amount * (3 - 2 * amount) : 0;
      if (Math.abs(next - blend) < 0.0001) return;
      blend = next;
      stage.enabled = blend > 0.0001;
      viewer.scene.requestRender();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      viewer.scene.postProcessStages.remove(stage);
      viewer.scene.requestRender();
    },
  };
}
