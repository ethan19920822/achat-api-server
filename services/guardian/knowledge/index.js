'use strict';

const world = require('./world');
const guardian = require('./guardian');
const capsule = require('./capsule');
const palace = require('./palace');
const people = require('./people');
const importantDates = require('./importantDates');
const driftBottle = require('./driftBottle');
const voice = require('./voice');
const membership = require('./membership');
const settings = require('./settings');
const notifications = require('./notifications');
const support = require('./support');

const KNOWLEDGE = Object.freeze({
  world,
  guardian,
  capsule,
  palace,
  people,
  importantDates,
  driftBottle,
  voice,
  membership,
  settings,
  notifications,
  support,
});

function getKnowledge(topic) {
  return KNOWLEDGE[topic] || '';
}

module.exports = {
  KNOWLEDGE,
  getKnowledge,
};
