import { mkdir, writeFile } from 'node:fs/promises';

const directory = new URL('../public/audio/', import.meta.url);
const sampleRate = 22_050;
const cycle = 2 * Math.PI;
let seed = 143;
const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x80000000 - 1;
};
const fade = (time, duration, attack, release) => Math.min(1, time / attack, (duration - time) / release);

async function writeSample(name, duration, sample) {
    const length = Math.ceil(duration * sampleRate);
    const wav = Buffer.alloc(44 + length * 2);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(length * 2, 40);
    for (let i = 0; i < length; i++) {
        const amplitude = sample(i / sampleRate, duration);
        wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, amplitude)) * 32767), 44 + i * 2);
    }
    await writeFile(new URL(name + '.wav', directory), wav);
}

await mkdir(directory, { recursive: true });
let bass = 0, mid = 0;
await writeSample('steam-chuff', .38, (time, duration) => {
    const burst = noise();
    bass += .036 * (burst - bass);
    mid += .21 * (burst - mid);
    return fade(time, duration, .009, .065) * Math.exp(-8 * time)
        * (1.65 * bass + .66 * mid + .18 * burst + .14 * Math.sin(cycle * (81 * time - 35 * time ** 2)));
});
mid = 0;
await writeSample('steam-idle', .9, (time, duration) => {
    const rush = noise();
    mid += .09 * (rush - mid);
    return fade(time, duration, .14, .35) * (.18 * rush - .13 * mid);
});
await writeSample('steam-whistle', 1.65, (time, duration) => {
    const ramp = 1 - Math.exp(-14 * time);
    const tone = [384, 479, 574].reduce((mix, hz, index) => {
        const phase = cycle * hz * (time - .005 * (1 - ramp)) + .31 * Math.sin(cycle * 5.7 * time + index);
        return mix + Math.sin(phase) * .18 + Math.sin(2 * phase) * .05 + Math.sin(3 * phase) * .018;
    }, 0);
    return fade(time, duration, .18, .34) * (ramp * tone * (.88 + .12 * Math.sin(cycle * 7 * time)) + .085 * noise());
});
mid = 0;
await writeSample('brake-squeal', 1.22, (time, duration) => {
    const grit = noise();
    mid += .14 * (grit - mid);
    const pitch = cycle * (1670 * time - 175 * time ** 2);
    return fade(time, duration, .095, .34) * (.53 + .47 * Math.sin(cycle * 9.4 * time) ** 2)
        * (.25 * Math.sin(pitch + 3.4 * Math.sin(cycle * 3.1 * time)) + .11 * Math.sin(pitch * 1.47)
            + .13 * grit + .35 * mid);
});
