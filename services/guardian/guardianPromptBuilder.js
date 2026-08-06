'use strict';

// 舊入口相容層。新核心統一交給 guardianOS。
const { buildGuardianOS } = require('./guardianOS');

function buildGuardianPrompt({ message, basePrompt, brainPrompt }) {
  return buildGuardianOS({
    message,
    brainPrompt: brainPrompt || basePrompt || '',
  });
}

module.exports = { buildGuardianPrompt, buildGuardianOS };
