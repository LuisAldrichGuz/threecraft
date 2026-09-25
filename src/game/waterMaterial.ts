import * as THREE from 'three'

/**
 * El agua con shader propio, al estilo de los packs de shaders de Minecraft:
 * olas pequeñas en la superficie, la textura fluyendo, brillo del sol que
 * titila, y reflejo del color del cielo que crece con el ángulo (Fresnel), que
 * es lo que hace que el mar se vea de lejos como agua y no como un piso azul.
 * Respeta la luz por vértice del mallado y la niebla de la escena.
 */
const VERT = /* glsl */ `
  #include <fog_pars_vertex>
  uniform float time;
  // ondas donde el jugador toca el agua: (x, z, instante, fuerza)
  uniform vec4 ripple;
  attribute vec3 color;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vColor = color;
    vNormal = normal;
    vec3 p = position;
    if (normal.y > 0.5) {
      // olas: dos senos cruzados, pequeñas para que no se vean los bordes
      p.y += sin(p.x * 1.4 + time * 1.7) * 0.035 + cos(p.z * 1.1 + time * 1.3) * 0.035;
      float age = time - ripple.z;
      if (ripple.w > 0.0 && age < 2.5) {
        float d = length(p.xz - ripple.xy);
        // anillo que se expande y se apaga
        p.y += sin(d * 5.0 - age * 9.0) * exp(-d * 0.7) * exp(-age * 1.6) * ripple.w * 0.09;
      }
    }
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`
const FRAG = /* glsl */ `
  #include <fog_pars_fragment>
  uniform sampler2D map;
  uniform float time;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 skyColor;
  uniform float daylight;
  uniform vec2 uvScale;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    // la textura fluye despacio dentro de su tile del atlas
    vec2 flow = vec2(sin(time * 0.15) * 0.5, time * 0.05);
    vec2 uv = vUv + mod(flow, 1.0) * uvScale * 0.0;
    vec4 tex = texture2D(map, uv);
    vec3 base = tex.rgb * vColor;

    vec3 viewDir = normalize(cameraPosition - vWorld);
    // normal perturbada para que el brillo del sol titile como en el agua de verdad
    vec3 n = vNormal;
    if (vNormal.y > 0.5) {
      float dx = cos(vWorld.x * 1.4 + time * 1.7) * 0.05 + sin(vWorld.z * 2.3 - time * 2.1) * 0.03;
      float dz = -sin(vWorld.z * 1.1 + time * 1.3) * 0.05 + cos(vWorld.x * 2.7 + time * 1.9) * 0.03;
      n = normalize(vec3(-dx, 1.0, -dz));
    }
    float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
    vec3 col = mix(base, skyColor * (0.6 + 0.4 * daylight), fresnel * 0.75);

    vec3 h = normalize(sunDir + viewDir);
    float spec = pow(max(dot(n, h), 0.0), 90.0) * daylight;
    col += sunColor * spec * 1.2;

    float alpha = 0.62 + fresnel * 0.33;
    gl_FragColor = vec4(col, alpha);
    #include <fog_fragment>
  }
`

export class WaterMaterial extends THREE.ShaderMaterial {
  constructor(map: THREE.Texture) {
    super({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          map: { value: map },
          time: { value: 0 },
          sunDir: { value: new THREE.Vector3(0, 1, 0) },
          sunColor: { value: new THREE.Color(0xfff2c0) },
          skyColor: { value: new THREE.Color(0x87c8f0) },
          daylight: { value: 1 },
          uvScale: { value: new THREE.Vector2(1, 1) },
          ripple: { value: new THREE.Vector4(0, 0, -10, 0) },
        },
      ]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    })
    this.uniforms.map.value = map
  }

  /** una onda en (x, z) con esa fuerza (0..1) */
  ripple(x: number, z: number, strength: number) {
    this.uniforms.ripple.value.set(x, z, this.uniforms.time.value, strength)
  }

  update(time: number, sunDir: THREE.Vector3, sunColor: THREE.Color, skyColor: THREE.Color, daylight: number) {
    this.uniforms.time.value = time
    this.uniforms.sunDir.value.copy(sunDir)
    this.uniforms.sunColor.value.copy(sunColor)
    this.uniforms.skyColor.value.copy(skyColor)
    this.uniforms.daylight.value = daylight
  }
}
