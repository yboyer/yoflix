FROM node:24.22.0-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS builder

WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci
COPY services ./services

USER node
