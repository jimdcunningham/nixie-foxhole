import test from 'node:test';import assert from 'node:assert/strict';import{worldRefreshArguments}from'./world-refresh.mjs';
test('world publishing requires a configured source and a complete refresh',()=>{assert.equal(worldRefreshArguments(),null);assert.equal(worldRefreshArguments({input:'prepared',onlyIds:['hospital']}),null);assert.equal(worldRefreshArguments({input:'prepared',onlyIds:null,limited:true}),null);assert.deepEqual(worldRefreshArguments({input:'prepared',onlyIds:null}),['--world-input','prepared','--world-format','compact']);});

