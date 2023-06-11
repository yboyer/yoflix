FROM node:lts-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci
COPY . .
CMD npm start
