import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { normalizeExpectedPhone } from './phone.mjs';
export async function openStore(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, 'instance.lock');
  try {
    const old = JSON.parse(await readFile(lockPath, 'utf8'));
    try { process.kill(old.pid, 0); throw new Error('This data directory is already in use.'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    await unlink(lockPath);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const lock = await open(lockPath, 'wx', 0o600);
  await lock.writeFile(JSON.stringify({pid: process.pid}));
  const path = join(directory, 'state.json');
  let state;
  try { state = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') { await lock.close(); await unlink(lockPath); throw new Error('State cannot be read. Restore a backup; the file was not overwritten.'); }
    state = { version: 1, token: randomBytes(32).toString('base64url'), passwordHash: '', confirmedAccount:'', settings: { mode:'demo', timezone:'Asia/Bangkok', allowedHosts:[], retention:500, expectedPhone:'',autoResume:false }, targets:[], jobs:[], runs:[], messages:[], contacts:[] };
  }
  if (state.version !== 1 || !Array.isArray(state.jobs) || !Array.isArray(state.runs)) throw new Error('Unsupported or damaged state.');
  state.messageSequence=state.messageSequence||0;
  state.settings.autoResume=state.settings.autoResume===true;
  try {state.settings.expectedPhone=normalizeExpectedPhone(state.settings.expectedPhone||'',{allowEmpty:true});}
  catch {state.settings.autoResume=false;}
  // Never manufacture a verified account by converting a legacy local/LID-like value.
  if(state.confirmedAccount&&(!/^[1-9]\d{7,14}$/.test(state.confirmedAccount)||state.confirmedAccount!==state.settings.expectedPhone)){state.confirmedAccount='';state.settings.autoResume=false;}
  for(const message of state.messages)if(!message.seq)message.seq=++state.messageSequence;
  for (const run of state.runs) if (run.status === 'submitting') { run.status = 'unknown'; run.error = 'Application stopped before submission outcome was saved. Inspect WhatsApp before retrying.'; }
  if(state.sessionNotice?.status==='submitting')state.sessionNotice.status='unknown';
  for(const notice of Object.values(state.sessionNoticeMap||{}))if(notice.status==='submitting')notice.status='unknown';
  for(const job of state.jobs)if(job.pendingBatch)for(const item of job.pendingBatch.items||[])if(item.status==='submitting'){const receipt=state.runs.find(run=>run.id===item.runId);item.status=receipt&&['submitted','simulated'].includes(receipt.status)?receipt.status:receipt?.status==='not_submitted'?'pending':'unknown';if(item.status==='unknown'){job.enabled=false;job.lastResult='batch_needs_review';}}
  for(const run of state.runs)if(run.status==='unknown'&&run.jobId){const job=state.jobs.find(j=>j.id===run.jobId);if(job)job.enabled=false;}
  let queue = Promise.resolve();
  const save = () => { const snapshot = JSON.stringify(state, null, 2); queue = queue.then(async () => { await writeFile(`${path}.tmp`, snapshot, {mode:0o600}); await rename(`${path}.tmp`, path); }); return queue; };
  await save();
  return { state, save, async close() { await queue; await lock.close(); await unlink(lockPath); } };
}
