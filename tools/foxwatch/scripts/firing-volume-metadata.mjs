import { foxholeFiringVolumeSchema } from '../../../packages/foxhole-schema/src/manifest-schema.ts';

/** Apply the same authored origin/heading overrides as the published ground range. */
export function alignFiringVolume(range, source = range.firingVolume) {
    if (!source) return undefined;
    const volume = foxholeFiringVolumeSchema.parse(source);
    if (volume.reference) {
        const reference=volume.reference;
        const heading=range.rotation ?? range.r ?? reference.heading;
        const angle=(heading-reference.heading)*Math.PI/180, c=Math.cos(angle), s=Math.sin(angle);
        const center=[Number(range.x ?? 0),Number(range.y ?? 0)];
        for (const point of [volume.origin, ...(volume.muzzleOrigins ?? []), ...(volume.payloadPose ? [volume.payloadPose.maximumOrigin] : [])]) {
            const x=point[0]-reference.origin[0], y=point[1]-reference.origin[1];
            point[0]=center[0]+c*x-s*y; point[1]=center[1]+s*x+c*y;
        }
        const [qx,qy,qz,qw]=volume.orientation, ch=Math.cos(angle/2), sh=Math.sin(angle/2);
        volume.orientation=[ch*qx-sh*qy,ch*qy+sh*qx,ch*qz+sh*qw,ch*qw-sh*qz];
        volume.reference={origin:center,heading};
        return volume;
    }
    // Older catalogs used the ground-range center as their firing origin.
    volume.origin[0] = Number(range.x ?? 0);
    volume.origin[1] = Number(range.y ?? 0);
    const heading = range.rotation ?? range.r ?? 0;
    if (Number.isFinite(heading) && (volume.source !== 'mount-dynamic-data' ? volume.coneHalfAngle < 180 : volume.maxYaw - volume.minYaw < 360)) {
        const [x,y,z,w] = volume.orientation;
        const yaw = Math.atan2(2 * (w*z+x*y),1-2*(y*y+z*z)) * 180 / Math.PI;
        const center = volume.source !== 'mount-dynamic-data' ? 0 : (volume.minYaw + volume.maxYaw) / 2;
        const delta = (heading - yaw - center) * Math.PI / 360;
        const c = Math.cos(delta), s = Math.sin(delta);
        volume.orientation = [c*x-s*y,c*y+s*x,c*z+s*w,c*w-s*z];
    }
    return volume;
}
