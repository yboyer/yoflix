FROM node:24.19.0-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS builder

WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci
COPY services ./services

USER node
