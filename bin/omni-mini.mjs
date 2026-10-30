#!/usr/bin/env node
import {main} from '../src/mini-cli.mjs';
main(process.argv.slice(2)).catch(e=>{console.error('错误 / Error: '+e.message);process.exitCode=1;});
