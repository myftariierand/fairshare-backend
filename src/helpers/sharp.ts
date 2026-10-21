// src/common/sharp.ts
import type { Sharp } from 'sharp';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp') as (input?: Buffer | string) => Sharp;

export default sharp;
