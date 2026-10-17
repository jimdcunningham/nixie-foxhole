import assert from 'node:assert/strict';
import test from 'node:test';
import assets from '../src/scene-v2-assets-node.ts';
import { renderFoxholeStructureFiringVolumes } from '../src/scene-v2-structure-range-overlays.ts';

test('all catalog AI garrisons and pillboxes retain their source gun heights and offsets', () => {
    const expected: Record<string, readonly [number, number, number]> = {
        mgait1: [2.68,-0.01067,2.6243], mgait2: [2.68,-0.01067,2.6243], mgait3: [2.61,0,2.01],
        rifleait1: [3,0,2.2], rifleait2: [3,0,2.2], rifleait3: [3,0,2.26],
        atgunait1: [2.98,0,2.67067], atgunait2: [2.98,0,2.67067], atgunait3: [4.84,0,2.36],
        mgpillbox: [2,0,1.1], riflepillbox: [2.8,-0.01749,0.9], atpillbox: [2.2,0,1.66359], isgpillbox: [2.2,0,1.66359],
        artilleryait1: [2.06801,0,1.98435], artilleryait2: [3.78628,0,1.89237], artilleryait3: [2.49838,0,2.63672],
    };
    for (const [id, origin] of Object.entries(expected)) {
        const asset=assets[id]!, source=asset.ranges!.find(range=>range.firingVolume)!.firingVolume!;
        assert.ok(source.originSource==='muzzle-component' || source.originSource==='gun-bone',id);
        origin.forEach((value,i)=>assert.ok(Math.abs(source.origin[i]!-value)<0.0001,`${id} source axis ${i}`));
        const volume=renderFoxholeStructureFiringVolumes(asset,{}, {destroyed:false,packaged:false})[0]!;
        assert.ok(volume,`${id} must render its source-backed AI volume`);
        const offset=asset.model!.blueprintOrigin!;
        origin.forEach((value,i)=>assert.ok(Math.abs(volume.origin[i]!-(value*32+[offset.x,offset.y,offset.z][i]!))<0.004,`${id} model axis ${i}`));
    }
});

test('tankette gun sockets face forward and do not inherit stale ground-range centers', () => {
    for (const [id,x] of [['tankettec',1.85378],['tanketteoffensivec',2.16036]] as const) {
        const asset=assets[id]!, source=asset.ranges![0]!.firingVolume!;
        assert.equal(source.originSource,'muzzle-socket');
        assert.ok(Math.abs(source.origin[0]-x)<0.001,id);
        assert.ok(Math.abs(source.origin[1]-0.28763)<0.001,id);
        assert.ok(Math.abs(source.orientation[3])>0.99999,`${id} must not acquire a quarter turn`);
        assert.ok(Math.abs(source.origin[0]-(asset.ranges![0]!.x??0))>1,'seat position must not replace the gun');
        const volume=renderFoxholeStructureFiringVolumes(asset,{'foxhole.debug.ranges.vehicleWeapons':true},{destroyed:false,packaged:false})[0]!;
        assert.ok(volume);
        assert.ok(Math.abs(volume.origin[0]-source.origin[0]*32)<0.0001);
    }
});

test('recovered shared-skeleton and legacy guns retain distinct source muzzle bindings', () => {
    const expected: Record<string, string[]> = {
        battletankw:['S_MainGunMuzzle'], mediumtank2multiw:['S_ComTurretMuzzle'],
        mediumtank2rangew:['S_MediumTank2RangeWAssaultRifle_L'], lighttankflamec:['S_Muzzle_FlameC'],
        lighttank2infantryc:['S_Infantry_Muzzle_R','S_Infantry_Muzzle_L'], halftracktwinw:['S_MuzzleTwinL','S_MuzzleTwinR'],
        halftrackmultiw:['S_HalftrackMultiW_0'], armoredcarflamew:['S_Muzzle_Flame'],
        aircraftparatrooperw:['S_Muzzle_AircraftParatrooperW_MG'],
        mediumboatw:['S_BowGunnerLMuzzle','S_PortGunnerLMuzzle','S_StarboardGunnerLMuzzle'],
        largefieldmultiw:['S_MuzzleC'], aircraftbomberw:['S_AicraftBomberW_Top_Muzzle_01','S_AicraftBomberW_Back_Muzzle_01'],
        gunboatc:['S_GunboatCMainGunMuzzle'], aircraftparatrooperc:['S_AircraftParatrooperC_MG_Muzzle'],
        mech:['S_MainGunMuzzle','S_LeftGunMuzzle','S_RightGunMuzzle'],
    };
    for (const [id,names] of Object.entries(expected)) {
        const asset=assets[id]!;
        for(const name of names) {
            const source=asset.ranges!.find(range=>range.firingVolume?.originName===name)?.firingVolume;
            assert.ok(source,`${id}: missing ${name}`);
            assert.ok(source.originSource==='muzzle-socket'||source.originSource==='muzzle-component',id);
        }
        assert.ok(renderFoxholeStructureFiringVolumes(asset,{'foxhole.debug.ranges.vehicleWeapons':true},{destroyed:false,packaged:false}).length>=names.length,id);
    }
    for(const range of assets.mech!.ranges!) if(range.firingVolume) assert.ok(range.firingVolume.origin[2]>1,'mech muzzle fell back to an uninitialized component');
    const boat=assets.mediumboatw!.ranges!.flatMap(range=>range.firingVolume??[]);
    assert.ok(boat.find(volume=>volume.originName==='S_PortGunnerLMuzzle')!.origin[1]<-2);
    assert.ok(boat.find(volume=>volume.originName==='S_StarboardGunnerLMuzzle')!.origin[1]>2);
    const main=assets.battletankw!.ranges!.find(range=>range.firingVolume?.originName==='S_MainGunMuzzle')!.firingVolume!;
    assert.ok(Math.abs(main.origin[0]-3.62988)<0.001);
    assert.ok(Math.abs(main.origin[2]-1.27306)<0.001);
    assert.ok(Math.abs(main.orientation[3])>0.99999,'main gun acquired an extra quarter turn');
});

test('remaining initialization-bound guns retain their source origins and launcher axes', () => {
    const expected: Record<string, [string, number, number, number][]> = {
        motorcycleoffensivec:[['S_Muzzle',1.73415,-0.55052,0.76473]],
        landingcraftoffensivec:[['S_Muzzle',2.88139,0.63233,1.26671]],
        scoutvehicleoffensivew:[['S_Muzzle',0.28917,0.00001,0.82404]],
        truckoffensivec:[['S_Muzzle',3.60915,0.5552,1.65804]],
        scoutvehicleoffensivec:[['S_Muzzle',-0.38509,0.32216,0.90299]],
        aircraftfighter2c:[['S_AircraftFighter2C_Top_Gunner_0',2.07726,-0.72919,1.40527]],
        aircrafttorpedow:[['S_AircraftTorpedoW_Muzzle',-0.00393,6.16677,0.28913]],
        aircraftdivec:[['S_AircraftDiveC_Muzzle_L',0.06061,2.0636,0.9044]],
        aircraftbomberc:[['S_Muzzle_Fore_0',0,-7.11152,0.46479],['S_Muzzle_Mid_0',0.00005,7.46581,1.46248],['S_Muzzle_Aft_0',-0.01029,15.62941,0.23921]],
        armoredcar2multiw:[['PayloadInstancedStaticMesh',-1.73084,-0.56515,0.8299]],
        truckmultic:[['PayloadInstancedStaticMesh',-4.00573,1.52788,1.1481]],
        gunboat2c:[['PayloadInstancedStaticMesh',-4.47388,-1.2613,5.07751]],
    };
    let count=0;
    for(const [id,frames] of Object.entries(expected)) {
        const asset=assets[id]!;
        for(const [name,...position] of frames) {
            const source=asset.ranges!.find(range=>range.firingVolume?.originName===name)?.firingVolume;
            assert.ok(source,`${id}/${name}`);
            assert.equal(source.originSource,name==='PayloadInstancedStaticMesh'?'muzzle-component':'muzzle-socket',id);
            position.forEach((value,i)=>assert.ok(Math.abs(source.origin[i]!-value)<0.001,`${id} axis ${i}`));
            count++;
        }
        const appearance={destroyed:false,packaged:false};
        assert.deepEqual(renderFoxholeStructureFiringVolumes(asset,{},appearance),[],'vehicle debug gate must stay closed');
        assert.ok(renderFoxholeStructureFiringVolumes(asset,{'foxhole.debug.ranges.vehicleWeapons':true},appearance).length>=frames.length,id);
    }
    assert.equal(count,14);
    for(const [id,forward] of [['armoredcar2multiw',1],['truckmultic',1],['gunboat2c',-1]] as const) {
        const q=assets[id]!.ranges!.find(range=>range.firingVolume)?.firingVolume!.orientation!;
        const x=1-2*(q[1]*q[1]+q[2]*q[2]);
        assert.equal(Math.sign(x),forward,`${id}: visual mesh rotation changed firing direction`);
        assert.ok(Math.abs(x)>0.8,`${id}: source firing-ready pose lost its forward axis`);
    }
});
