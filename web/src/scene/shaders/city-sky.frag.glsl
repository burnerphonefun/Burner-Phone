// sunny city: a sunset gradient, a hot sun with two halos, and a few long thin clouds lit from below
varying vec3 vP;
uniform vec3 sunDir;

vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

void main() {
  vec3 d = normalize(vP);
  float h = clamp(d.y, -0.1, 1.0);
  vec3 top = lin(vec3(0.24, 0.16, 0.44));
  vec3 mid = lin(vec3(0.99, 0.47, 0.36));
  vec3 low = lin(vec3(1.0, 0.72, 0.42));
  vec3 c = mix(low, mid, smoothstep(0.0, 0.16, h));
  c = mix(c, top, smoothstep(0.16, 0.7, h));
  float s = clamp(dot(d, sunDir), 0.0, 1.0);
  c += vec3(1.0, 0.78, 0.5) * pow(s, 900.0) * 6.0 + vec3(1.0, 0.66, 0.32) * pow(s, 40.0) * 1.1 + vec3(1.0, 0.5, 0.25) * pow(s, 5.0) * 0.3;
  float band = smoothstep(0.035, 0.0, abs(h - 0.11 - 0.02 * sin(d.x * 7.0))) * (0.5 + 0.5 * sin(d.x * 23.0 + d.z * 5.0));
  c = mix(c, vec3(1.0, 0.66, 0.52), band * 0.35);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
