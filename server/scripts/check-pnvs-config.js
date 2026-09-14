// Only names/statuses are printed. No secret values, phone numbers or SMS calls.
require('dotenv').config({ path: require('path').join(__dirname,'../.env') });
const { REQUIRED, checkConfig }=require('../src/services/sms/config');
const { missing }=checkConfig();
for(const name of REQUIRED) process.stdout.write(`${name}: ${missing.includes(name)?'MISSING':'SET'}\n`);
process.exitCode=missing.length?1:0;
