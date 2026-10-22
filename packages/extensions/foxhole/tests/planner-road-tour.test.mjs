import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlannerRoadTour, nativeTourPose, plannerTourPose } from '../app/plugins/foxhole/nixie/map/planner-road-tour.mjs';
import { RoadTour, buildRoadNetwork } from '../../../foxhole-world/authoring/road-tour.mjs';

function fixture() {
    const canvas = new EventTarget();
    canvas.ownerDocument = new EventTarget();
    const initial = { position: { x: 160, y: -320, z: 3200 }, target: { x: 160, y: -320, z: 0 }, projection: 'perspective' };
    let pose = structuredClone(initial), status, time = 0, hidden = false, mode = '3d', requests = 0;
    const writes = [], publications = [], shakeWrites = [];
    const scene = { async createRoadTour() {
        requests++;
        return new RoadTour(buildRoadNetwork({ curves: [{ id: 'road', mesh: 'road', points: [[0, 0, 0], [300, 0, 0], [600, 0, 0]] }] }), { terrain: () => 0, random: () => 0.4 });
    } };
    let regions = [{ id: 'fixture', position: { x: 160, y: 320 }, scene }];
    const options = { region: '', speed: 12, view: 'close' };
    const control = createPlannerRoadTour({ canvas, getRegions: () => regions, getOptions: () => options,
        readPose: () => pose, writePose: value => { writes.push(value); if (value) pose = { ...structuredClone(value), projection: 'perspective' }; return true; },
        setCameraShake: value => shakeWrites.push(value), viewMode: () => mode, onStatus: value => { status = value; publications.push(value); }, hidden: () => hidden, now: () => time });
    return { canvas, initial, scene, control, options, writes, publications, shakeWrites, rename(label) { regions[0].label = label; }, get status() { return status; }, get requests() { return requests; },
        step(ms) { time += ms; control.update(16); }, setHidden(value) { hidden = value; }, setMode(value) { mode = value; }, retire() { regions = []; } };
}

test('native Y-up metres round-trip planner Z-up coordinates and region offsets', () => {
    const position = { x: -15000, y: 10000 };
    const pose = { position: { x: -12345, y: -9876, z: 1500 }, target: { x: -13500, y: -9500, z: 800 } };
    assert.deepEqual(plannerTourPose(nativeTourPose(pose, position), position), pose);
});

test('metadata is lazy; layer-independent camera following pauses, resumes, advances and restores', async () => {
    const f = fixture();
    assert.equal(f.requests, 0);
    await f.control.start();
    assert.equal(f.status.state, 'running');
    assert.equal(f.requests, 1);
    f.step(16); f.step(50); f.step(50); f.step(500);
    assert.equal('p95' in f.status, false, 'frame telemetry stays in canvas diagnostics');
    const before = f.writes.length;
    f.canvas.dispatchEvent(new Event('pointerdown'));
    assert.equal(f.status.state, 'paused');
    assert.equal(f.writes.at(-1), null);
    f.step(1000);
    assert.equal(f.writes.length, before + 1);
    await f.control.start();
    assert.equal(f.requests, 1, 'resume retains route metadata');
    f.control.next();
    assert.match(f.control.diagnostics()[0], /route:2/);
    f.control.restore();
    const { projection, ...initial } = f.initial;
    assert.deepEqual(f.writes.at(-2), initial);
    assert.equal(f.writes.at(-1), null);
    assert.equal(f.status.canRestore, false);
    f.control.destroy();
});

test('hidden time is excluded, Escape works from toolbar focus, and disposal removes listeners', async () => {
    const f = fixture(); await f.control.start();
    f.step(16); f.step(16);
    const beforeHidden = f.writes.length;
    f.setHidden(true); f.step(10000);
    assert.equal(f.writes.length, beforeHidden);
    f.setHidden(false); f.step(16); f.step(500);
    assert.equal('fps' in f.status, false);
    const escape = new Event('keydown'); Object.defineProperty(escape, 'key', { value: 'Escape' });
    f.canvas.ownerDocument.dispatchEvent(escape);
    assert.equal(f.status.state, 'idle');
    f.control.destroy(); const count = f.writes.length;
    f.canvas.ownerDocument.dispatchEvent(escape); f.canvas.dispatchEvent(new Event('wheel'));
    assert.equal(f.writes.length, count);
});

test('region retirement, flat view, and late metadata completion release camera ownership', async () => {
    const f = fixture(); await f.control.start(); f.retire(); f.step(16);
    assert.equal(f.status.state, 'idle'); assert.equal(f.writes.at(-1), null);
    const g = fixture(); let resolve;
    g.scene.createRoadTour = () => new Promise(done => resolve = done);
    const pending = g.control.start(); g.canvas.dispatchEvent(new Event('pointerdown')); resolve({ start() { throw Error('stale'); } }); await pending;
    assert.equal(g.status.state, 'idle'); assert.equal(g.status.error, null);
    const h = fixture(); h.setMode('flat'); await h.control.start();
    assert.equal(h.requests, 0); assert.match(h.status.error, /3D perspective/);
    f.control.destroy(); g.control.destroy(); h.control.destroy();
});

test('running routes and diagnostic pulls do not republish unchanged sidebar control state', async()=>{
 const f=fixture();f.options.speed=48;f.options.view='variety';await f.control.start();const count=f.publications.length,status=f.status;
 try{for(let i=0;i<1000;i++){f.step(16);if(i%15===0)f.control.diagnostics();}assert.equal(f.publications.length,count);assert.equal(f.status,status);assert.ok(f.writes.length>=1000);f.control.next();assert.equal(f.publications.length,count,'advancing a route does not invalidate controls');f.rename('Renamed Region');f.step(600);assert.equal(f.publications.length,count+1);assert.equal(f.status.regions[0].label,'Renamed Region');f.step(600);assert.equal(f.publications.length,count+1);}finally{f.control.destroy();}
});


test('manual keyboard camera navigation pauses automation and removes its listener on disposal',async()=>{
 const f=fixture();await f.control.start();
 f.canvas.dispatchEvent(new Event('nixie-camera-navigation'));
 assert.equal(f.status.state,'paused');assert.equal(f.writes.at(-1),null);
 const count=f.writes.length;f.step(1000);assert.equal(f.writes.length,count);
 f.control.destroy();const after=f.writes.length;
 f.canvas.dispatchEvent(new Event('nixie-camera-navigation'));assert.equal(f.writes.length,after);
});



test('shake keeps running during canvas input and road tours without owning the camera pose',async()=>{
 const f=fixture();f.control.toggleCameraShake();assert.equal(f.status.shaking,true);assert.equal(f.shakeWrites.at(-1),.35);
 assert.equal(f.writes.length,0,'shake never writes or restores a navigation pose');
 for(const event of ['pointerdown','wheel','nixie-camera-navigation']){f.canvas.dispatchEvent(new Event(event));assert.equal(f.status.shaking,true);assert.equal(f.shakeWrites.at(-1),.35);}
 await f.control.start();assert.equal(f.status.state,'running');assert.equal(f.status.shaking,true);
 const publications=f.publications.length;for(let i=0;i<100;i++)f.step(16);assert.equal(f.publications.length,publications);
 f.options.shakeStrength=2;f.step(16);assert.equal(f.shakeWrites.at(-1),2);assert.equal(f.status.state,'running');
 f.control.stop();assert.equal(f.status.shaking,true,'stopping the tour leaves shake enabled');
 const writes=f.writes.length;f.control.toggleCameraShake();assert.equal(f.status.shaking,false);assert.equal(f.shakeWrites.at(-1),0);assert.equal(f.writes.length,writes);
 f.control.destroy();
});

test('Escape, leaving 3D and destruction release shake without leaving a pose offset',()=>{
 for(const action of ['escape','mode','destroy']){
  const f=fixture();f.control.toggleCameraShake();
  if(action==='escape'){const e=new Event('keydown');Object.defineProperty(e,'key',{value:'Escape'});f.canvas.ownerDocument.dispatchEvent(e);}
  else if(action==='mode'){f.setMode('flat');f.step(16);}
  else f.control.destroy();
  assert.equal(f.status.shaking,false,action);assert.equal(f.shakeWrites.at(-1),0,action);f.control.destroy();
 }
});
