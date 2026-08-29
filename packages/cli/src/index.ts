#!/usr/bin/env node
import { main } from './main.js';

const exitCode = await main(process.argv.slice(2));
process.exitCode = exitCode;
