# git-server-agents: webhook server and agent worker in one container.
# Build: docker build -t git-server-agents .
# Run:   docker run -p 3000:3000 --env-file .env git-server-agents
FROM node:26-slim

ENV NODE_ENV=production \
    PORT=3000 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && rm -rf /home/node/.npm

COPY --chown=node:node . .

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
