FROM node:24.21.0-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS builder

WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci
COPY services ./services

USER node
