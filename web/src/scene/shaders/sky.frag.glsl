// the shared world sky (kit.js): three-stop gradient plus an optional sun disc and glow
uniform vec3 top;
uniform vec3 mid;
uniform vec3 low;
uniform vec3 sunDir;
uniform vec3 sunC;
uniform float sunPow;
uniform float glow;
varying vec3 vP;

void main() {
  float h = clamp(vP.y, -0.2, 1.0);
  vec3 c = mix(low, mid, smoothstep(-0.05, 0.16, h));
  c = mix(c, top, smoothstep(0.16, 0.78, h));
  float s = max(dot(normalize(vP), sunDir), 0.0);
  c += sunC * (pow(max(s, 1e-4), sunPow) * 1.3 + pow(max(s, 1e-4), 5.0) * glow);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
