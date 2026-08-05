'use strict';

const knowledge = Object.freeze({
  world: require('./world'),
  guardian: require('./guardian'),
  capsule: require('./capsule'),
  palace: require('./palace'),
  recipients: require('./recipients'),
  driftBottle: require('./driftBottle'),
  voice: require('./voice'),
  membership: require('./membership'),
  settings: require('./settings'),
  support: require('./support'),
  product: require('./product'),
});

function getKnowledge(topic) {
  return knowledge[topic] || '';
}

module.exports = { getKnowledge, knowledge };
