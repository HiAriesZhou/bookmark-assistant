// Unsigned clients read which sign-in methods this server offers.

import { Router } from 'express';
import { asyncHandler } from '../middleware/async-handler';
import { validateExtension } from '../middleware/auth';
import { publicDeploymentProfile } from '../services/deployment-profile';

const router: import('express').Router = Router();

router.get(
  '/',
  validateExtension,
  asyncHandler(async (_req, res) => {
    res.json(publicDeploymentProfile());
  })
);

export default router;
