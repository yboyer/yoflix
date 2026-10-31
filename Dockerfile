FROM node:26.12.1-slim@sha256:94816674c62774da0d099a947bf4613b9e1972a2733abd0d0cd80e795f8411d0 AS builder

WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci
COPY services ./services

USER node
