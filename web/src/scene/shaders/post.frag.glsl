// the rug look: drain the colour, push the contrast a little and close in a vignette as `gray` goes 0 → 1
uniform sampler2D tex;
uniform float gray;
uniform float aspect;
varying vec2 vUv;

void main() {
  vec3 c = texture2D(tex, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 g = vec3(l);
  g = (g - 0.18) * 1.18 + 0.18; // a bit more contrast in grey
  c = mix(c, max(g, 0.0) * 0.86, gray);
  vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);
  c *= 1.0 - gray * 0.55 * smoothstep(0.35, 1.05, length(q));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
