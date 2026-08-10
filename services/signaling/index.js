const { SignalingGateway } = require('./server');

async function main() {
  const gateway = new SignalingGateway({
    host: process.env.AGENTDESK_SIGNALING_HOST || '0.0.0.0',
    port: integer(process.env.PORT || process.env.AGENTDESK_SIGNALING_PORT, 8787),
    turnSecret: process.env.AGENTDESK_TURN_SECRET,
    turnUrls: process.env.AGENTDESK_TURN_URLS,
    turnTtlSeconds: integer(process.env.AGENTDESK_TURN_TTL_SECONDS, 3600)
  });
  await gateway.start();
  process.stdout.write(`AgentDesk signaling gateway listening on ${gateway.address()}\n`);
  const shutdown = async () => {
    await gateway.stop();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function integer(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
