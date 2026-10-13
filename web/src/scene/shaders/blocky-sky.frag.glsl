// blocky night: haze at the horizon fading up into the night colour
uniform vec3 top;
uniform vec3 hor;
varying vec3 vP;

void main() {
  float h = clamp(vP.y, 0.0, 1.0);
  gl_FragColor = vec4(mix(hor, top, smoothstep(0.0, 0.35, h)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
