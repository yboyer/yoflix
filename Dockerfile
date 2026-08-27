FROM node:24.19.0-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS builder

WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci
COPY services ./services

USER node
