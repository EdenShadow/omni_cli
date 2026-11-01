import test from 'node:test';
import assert from 'node:assert/strict';
import {formatCliError} from '../src/auth-feedback.mjs';
import {createRequest} from '../src/api.mjs';
test('CLI preserves security status and prints a compact support card without raw server details',async()=>{
  const request=createRequest({endpoint:'http://localhost'},async()=>Response.json({error:'server detail',code:'AUTH_BLOCKED',reference:'test-case',supportEmail:'edenworm@gmail.com'},{status:423}));
  let failure;try{await request('/api/auth/login','POST',{username:'test',password:'mock-only',client:'cli'});}catch(e){failure=e;}
  assert.equal(failure.status,423);const text=formatCliError(failure);
  assert.match(text,/edenworm@gmail.com/);assert.match(text,/test-case/);assert(!text.includes('server detail'));assert(!text.includes('mock-only'));
  assert.match(formatCliError({code:'AUTH_INVALID_CREDENTIALS',failures:9}),/9 \/ 10/);
});
