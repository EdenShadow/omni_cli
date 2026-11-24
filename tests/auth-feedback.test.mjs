import test from 'node:test';
import assert from 'node:assert/strict';
import {formatCliError} from '../src/auth-feedback.mjs';
import {createRequest} from '../src/api.mjs';
test('CLI preserves security status and prints uniform sign-in feedback without raw server details',async()=>{
  const request=createRequest({endpoint:'http://localhost'},async()=>Response.json({error:'server detail',code:'AUTH_BLOCKED',reference:'test-case',supportEmail:'edenworm@gmail.com'},{status:423}));
  let failure;try{await request('/api/auth/login','POST',{username:'test',password:'mock-only',client:'cli'});}catch(e){failure=e;}
  assert.equal(failure.status,423);const text=formatCliError(failure);
  assert.match(text,/Sign-in failed/);
  for(const marker of ['server detail','mock-only','test-case','locked','10'])assert.ok(!text.includes(marker));
  assert.equal(formatCliError({code:'AUTH_INVALID_CREDENTIALS',failures:9}),text);
  assert.equal(formatCliError({code:'AUTH_RATE_LIMITED'}),text);
  assert.equal(formatCliError({signInRejected:true,message:'internal hint'}),text);
});
