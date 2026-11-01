#!/usr/bin/env node
import {formatCliError} from '../src/auth-feedback.mjs';
import {main} from '../src/cli.mjs';
main(process.argv.slice(2)).catch(error=>{console.error(formatCliError(error));process.exitCode=1;});
