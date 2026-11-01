#!/usr/bin/env node
import {formatCliError} from '../src/auth-feedback.mjs';
import {main} from '../src/mini-cli.mjs';
main(process.argv.slice(2)).catch(e=>{console.error(formatCliError(e));process.exitCode=1;});
