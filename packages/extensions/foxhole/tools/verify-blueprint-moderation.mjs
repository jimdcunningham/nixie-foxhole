// Runs entirely in memory. Pass a local PGlite module path; it never connects to Supabase.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulePath = process.argv[2];
if (!modulePath) {
    throw new Error('Pass the path to @electric-sql/pglite/dist/index.js.');
}
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const query = (sql, args = []) => db.query(sql, args);
const scalar = async (sql, args) => Object.values((await query(sql, args)).rows[0])[0];
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const schema = fs.readFileSync(new URL('../tests/fixtures/blueprint-moderation-schema.sql', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../../nixie/supabase/migrations/20261003073620_blueprint_text_image_moderation.sql', import.meta.url), 'utf8');
const oldestFirstMigration = fs.readFileSync(new URL('../../../nixie/supabase/migrations/20261003095616_blueprint_moderation_oldest_first.sql', import.meta.url), 'utf8');
const queueOrderMigration = fs.readFileSync(new URL('../../../nixie/supabase/migrations/20261003110444_blueprint_moderation_queue_order.sql', import.meta.url), 'utf8');
try {
    await db.exec(schema);
    // Old default names and manual decisions predate the new publication guard.
    await query('insert into blueprints(id,name,approved) values ($1,$2,null),($3,$4,true),($5,$6,false)', [id(1), 'New Project', id(2), 'Reviewed depot', id(3), 'Rejected depot']);
    await db.exec(migration);
    for (const [n, date] of [[1, '2020-01-01'], [2, '2021-01-01'], [3, '2022-01-01'], [4, '2024-01-01'], [5, '2026-01-01']]) {
        if (n >= 4) {
            await query('insert into blueprints(id,name) values ($1,$2)', [id(n), `Depot ${n}`]);
        }
        await query('insert into bp_versions(id,blueprint_id,version,created_at) values ($1,$2,$3,$4)', [id(n + 100), id(n), '1.0', date]);
        if (n !== 1) {
            await query('update blueprints set version=$2 where id=$1', [id(n), id(n + 100)]);
        } else { // Model a historical default-title row without publishing it through the new guard.
            await db.exec('alter table blueprints disable trigger nixie_guard_blueprint_publication');
            await query('update blueprints set version=$2 where id=$1', [id(n), id(n + 100)]);
            await db.exec('alter table blueprints enable trigger nixie_guard_blueprint_publication');
        }
    }
    // Setting a version is a new publication, so re-establish historical manual states.
    await query('update blueprints set approved=true where id=$1', [id(2)]);
    await query('update blueprints set approved=false where id=$1', [id(3)]);
    await assert.rejects(query('insert into blueprints(id,name) values ($1,$2)', [id(9), 'New Project']), /default project title/);
    for (const title of ['Ｎｅｗ　Ｐｒｏｊｅｃｔ', 'New\u200b Project']) {
        await assert.rejects(query('insert into blueprints(id,name) values ($1,$2)', [id(9), title]), /default project title/);
    }
    await db.exec('set role authenticated');
    await assert.rejects(query('update blueprints set approved=true where id=$1', [id(4)]), /moderation service/);
    await db.exec('reset role');
    assert.equal(await scalar('select has_function_privilege(\'authenticated\',\'public.nixie_claim_blueprint_moderation(integer)\',\'execute\')'), false);
    assert.equal(await scalar('select has_table_privilege(\'anon\',\'public.nixie_blueprint_moderation\',\'select\')'), false);
    assert.equal(await scalar('select count(*) from nixie_discovery_catalog'), 1);
    const claimed = (await query('select * from nixie_claim_blueprint_moderation(2)')).rows;
    assert.deepEqual(claimed.map(job => job.blueprint_id), [id(5), id(4)]);
    assert.equal(await scalar('select count(*) from nixie_blueprint_moderation where blueprint_id in ($1,$2)', [id(2), id(3)]), 0);
    const finish = (job, state = 'approved', reviewer = null) => scalar('select nixie_finish_blueprint_moderation($1,$2,$3,$4,$5,$6,$7,$8)',
        [job.blueprint_id, job.fingerprint, job.lease_token, state, 'Test decision', 'a'.repeat(64), {}, reviewer]);
    const newest = claimed[0];
    assert.equal(await finish({ ...newest, lease_token: id(999) }), false);
    assert.equal(await finish(newest), true);
    assert.equal(await scalar('select approved from blueprints where id=$1', [id(5)]), true);
    assert.equal(await finish(newest), false); // Lease is single-use.
    await query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['blueprints', `${id(5)}/icon.webp`]);
    assert.equal(await scalar('select approved from blueprints where id=$1', [id(5)]), null);
    const changed = (await query('select * from nixie_claim_blueprint_moderation(1)')).rows[0];
    assert.equal(changed.blueprint_id, id(5));
    assert.notEqual(changed.fingerprint, newest.fingerprint);
    assert.equal(await finish(newest), false);
    assert.equal(await finish(changed), true);
    await query('update storage.objects set bucket_id=$1 where name=$2', ['other', `${id(5)}/icon.webp`]);
    assert.equal(await scalar('select approved from blueprints where id=$1', [id(5)]), null);
    const retry = (await query('select * from nixie_claim_blueprint_moderation(1)')).rows[0];
    assert.equal(await finish(retry, 'retry'), true);
    assert.ok(await scalar('select next_attempt_at>now() from nixie_blueprint_moderation where blueprint_id=$1', [id(5)]));
    assert.equal((await query('select * from nixie_claim_blueprint_moderation(1)')).rows[0].blueprint_id, id(1));
    // Expired leases recover, and text changes invalidate a reviewer snapshot.
    await query('update nixie_blueprint_moderation set lease_until=now()-interval \'1 second\' where blueprint_id=$1', [id(4)]);
    const recovered = (await query('select * from nixie_claim_blueprint_moderation(1)')).rows[0];
    assert.equal(recovered.blueprint_id, id(4));
    assert.notEqual(recovered.lease_token, claimed[1].lease_token);
    assert.equal(await finish(recovered, 'needs_review'), true);
    const reviewer = id(900);
    await query('insert into auth.users values ($1)', [reviewer]);
    await query('update blueprints set description=$2 where id=$1', [id(4), 'Changed after preview']);
    assert.equal(await finish(recovered, 'approved', reviewer), false);
    const fresh = (await query('select * from nixie_claim_blueprint_moderation(1)')).rows[0];
    assert.equal(await finish(fresh, 'needs_review'), true);
    assert.equal(await finish(fresh, 'approved', reviewer), true);
    await query('insert into tags values ($1,$2,$3)', [id(800), 'Depot', 'depot']);
    await query('insert into bp_tags values ($1,$2)', [id(4), id(800)]);
    assert.equal(await scalar('select approved from blueprints where id=$1', [id(4)]), null);
    const budgetJob = (await query('select * from nixie_claim_blueprint_moderation(1)')).rows[0];
    assert.equal(await scalar('select nixie_finish_blueprint_moderation($1,$2,$3,$4,$5,$6,$7)',
        [budgetJob.blueprint_id, budgetJob.fingerprint, budgetJob.lease_token, 'retry', 'Budget limit', null, { retryKind: 'budget' }]), true);
    assert.equal(await scalar('select attempts from nixie_blueprint_moderation where blueprint_id=$1', [budgetJob.blueprint_id]), 0);
    await query('update blueprints set approved=true where id=$1', [id(4)]);
    await query('update bp_versions set changelog=$2 where id=$1', [id(104), 'Changed version notes']);
    assert.equal(await scalar('select approved from blueprints where id=$1', [id(4)]), null);
    // The later migration reverses claim order without resetting existing work.
    const existingQueue = (await query('select * from nixie_blueprint_moderation order by blueprint_id')).rows;
    await db.exec(oldestFirstMigration);
    assert.deepEqual((await query('select * from nixie_blueprint_moderation order by blueprint_id')).rows, existingQueue);
    assert.equal(await scalar('select has_function_privilege(\'authenticated\',\'public.nixie_claim_blueprint_moderation(integer)\',\'execute\')'), false);
    assert.equal(await scalar('select has_function_privilege(\'service_role\',\'public.nixie_claim_blueprint_moderation(integer)\',\'execute\')'), true);
    for (const [n, date] of [[10, '1990-01-01'], [11, '1991-01-01'], [12, '1991-01-01'], [13, '2027-01-01']]) {
        await query('insert into blueprints(id,name) values ($1,$2)', [id(n), `Depot ${n}`]);
        await query('insert into bp_versions(id,blueprint_id,version,created_at) values ($1,$2,$3,$4)', [id(n + 100), id(n), '1.0', date]);
        await query('update blueprints set version=$2 where id=$1', [id(n), id(n + 100)]);
    }
    const oldestClaims = (await query('select * from nixie_claim_blueprint_moderation(2)')).rows;
    assert.deepEqual(oldestClaims.map(job => job.blueprint_id), [id(10), id(11)]);
    assert.equal((await query('select * from nixie_claim_blueprint_moderation(1)')).rows[0].blueprint_id, id(12));
    await query('update nixie_blueprint_moderation set lease_until=now()-interval \'1 second\' where blueprint_id=$1', [id(10)]);
    const oldestRecovered = (await query('select * from nixie_claim_blueprint_moderation(1)')).rows[0];
    assert.equal(oldestRecovered.blueprint_id, id(10));
    assert.notEqual(oldestRecovered.lease_token, oldestClaims[0].lease_token);
    assert.equal(await finish(oldestRecovered, 'retry'), true);
    // A backed-off older job does not block the next due publication.
    assert.equal((await query('select * from nixie_claim_blueprint_moderation(1)')).rows[0].blueprint_id, id(4));
    const queueBeforeConfiguration = (await query('select * from nixie_blueprint_moderation order by blueprint_id')).rows;
    await db.exec(queueOrderMigration);
    assert.deepEqual((await query('select * from nixie_blueprint_moderation order by blueprint_id')).rows, queueBeforeConfiguration);
    assert.equal(await scalar("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='nixie_claim_blueprint_moderation'"), 1);
    assert.equal(await scalar("select has_function_privilege('anon','public.nixie_claim_blueprint_moderation(integer,text)','execute')"), false);
    assert.equal(await scalar("select has_function_privilege('authenticated','public.nixie_claim_blueprint_moderation(integer,text)','execute')"), false);
    assert.equal(await scalar("select has_function_privilege('service_role','public.nixie_claim_blueprint_moderation(integer,text)','execute')"), true);
    for (const [n, date] of [[20, '1970-01-01'], [21, '1971-01-01'], [22, '1971-01-01'], [23, '2028-01-01'], [24, '2028-01-01'], [25, '2029-01-01']]) {
        await query('insert into blueprints(id,name) values ($1,$2)', [id(n), `Depot ${n}`]);
        await query('insert into bp_versions(id,blueprint_id,version,created_at) values ($1,$2,$3,$4)', [id(n + 100), id(n), '1.0', date]);
        await query('update blueprints set version=$2 where id=$1', [id(n), id(n + 100)]);
    }
    // Invalid orders fail before seeding or claiming any jobs.
    for (const order of ['invalid', '', null]) {
        await assert.rejects(query('select * from nixie_claim_blueprint_moderation(1,$1)', [order]), /order must be oldest or newest/);
    }
    assert.deepEqual((await query('select * from nixie_blueprint_moderation order by blueprint_id')).rows, queueBeforeConfiguration);
    await db.exec('set role service_role');
    const defaultClaims = (await query('select * from nixie_claim_blueprint_moderation(2)')).rows;
    assert.deepEqual(defaultClaims.map(job => job.blueprint_id), [id(20), id(21)]);
    const newestClaims = (await query("select * from nixie_claim_blueprint_moderation(3,'newest')")).rows;
    assert.deepEqual(newestClaims.map(job => job.blueprint_id), [id(25), id(24), id(23)]);
    assert.equal((await query("select * from nixie_claim_blueprint_moderation(1,'oldest')")).rows[0].blueprint_id, id(22));
    await db.exec('reset role');
    assert.equal(await finish(newestClaims[0]), true);
    await query("update nixie_blueprint_moderation set lease_until=now()-interval '1 second' where blueprint_id=$1", [id(20)]);
    const configuredRecovery = (await query("select * from nixie_claim_blueprint_moderation(1,'oldest')")).rows[0];
    assert.equal(configuredRecovery.blueprint_id, id(20));
    assert.notEqual(configuredRecovery.lease_token, defaultClaims[0].lease_token);
    assert.equal(await finish(configuredRecovery, 'retry'), true);
    assert.equal((await query("select * from nixie_claim_blueprint_moderation(1,'newest')")).rows[0].blueprint_id, id(13));
    console.info('Moderation migrations passed: oldest default, configurable newest/oldest claims, deterministic ties, preserved queue/permissions, leases, stale decisions, storage/text/tag invalidation, retries and manual review.');
} finally {
    await db.close();
}
