import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./resolve.mjs', pathToFileURL(import.meta.url));