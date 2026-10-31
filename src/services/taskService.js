const prisma = require('../db');

function enqueue(platform, event, payload) {
  return prisma.agentTask.create({
    data: { platform, event, status: 'pending', payload: JSON.stringify(payload) },
  });
}

module.exports = { enqueue };
