FROM node:22.12-alpine

WORKDIR /app

COPY services/signaling ./services/signaling
COPY src/mesh/protocol/signaling-auth.js ./src/mesh/protocol/signaling-auth.js
COPY src/mesh/domain/identity-link.js ./src/mesh/domain/identity-link.js

ENV AGENTDESK_SIGNALING_HOST=0.0.0.0
ENV AGENTDESK_SIGNALING_PORT=8787

EXPOSE 8787

USER node

CMD ["node", "services/signaling/index.js"]
