import { foxholeFiringVolumeSchema } from '../../../packages/foxhole-schema/src/manifest-schema.ts';

/** Apply the same authored origin/heading overrides as the published ground range. */
export function alignFiringVolume(range, source = range.firingVolume) {
    if (!source) return undefined;
    const volume = foxholeFiringVolumeSchema.parse(source);
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
