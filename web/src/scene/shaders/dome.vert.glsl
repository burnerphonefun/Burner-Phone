// sky domes: hand the fragment shader the view direction on the inside of a big sphere
varying vec3 vP;

void main() {
  vP = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
