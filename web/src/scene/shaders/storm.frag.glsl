// toon island storm wall: drifting purple bands with fast bright streaks, faded at every edge
uniform float t;
varying vec2 vUv;

void main() {
  float bands = 0.55 + 0.45 * sin(vUv.x * 160.0 + t * 0.7 + sin(vUv.y * 9.0 + t * 0.5) * 1.6);
  float streak = smoothstep(0.75, 1.0, sin(vUv.x * 420.0 - vUv.y * 30.0 + t * 1.3));
  float fade = smoothstep(0.0, 0.05, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y)) * smoothstep(0.0, 0.14, vUv.x) * (1.0 - smoothstep(0.86, 1.0, vUv.x));
  vec3 c = mix(vec3(0.33, 0.08, 0.62), vec3(0.78, 0.45, 1.0), bands * 0.45 + streak * 0.55);
  gl_FragColor = vec4(c, fade * (0.5 + 0.28 * bands + 0.2 * streak));
}
