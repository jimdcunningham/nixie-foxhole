// Subtract the eye before rotating/projecting. Combining projection and view
// first loses depth separation when world translations reach map-scale values.
// World-space varyings stay intact for native materials, lights and picking.
export function cameraRelativeClipPosition(position,gpu){
 return gpu
  ? `camera.uProjectionMatrix * vec4<f32>(mat3x3<f32>(camera.uViewMatrix[0].xyz,camera.uViewMatrix[1].xyz,camera.uViewMatrix[2].xyz) * (${position}-camera.uCameraPosition),1.0)`
  : `uProjectionMatrix * vec4(mat3(uViewMatrix) * (${position}-uCameraPosition),1.0)`;
}
