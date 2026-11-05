// src/common/sharp.ts
import type { Sharp, SharpOptions } from 'sharp';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp') as (
  input?: Buffer | string,
  options?: SharpOptions,
) => Sharp;

export default sharp;
